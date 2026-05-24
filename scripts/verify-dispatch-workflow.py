# scripts/verify-dispatch-workflow.py
# End-to-end verification of dispatcher -> driver -> delivery -> photo.
# Drives the running API (localhost:3000) + LocalStack S3. Each stage
# asserts; any failure raises non-zero exit.
import json, sys, uuid, urllib.request, urllib.error, datetime

API = 'http://localhost:3000'
DRIVER_PHONE = '0900000001'
DRIVER_PASSWORD = 'driver1pass'  # pragma: allowlist secret

def req(method, path, body=None, token=None, raw=None, ctype='application/json'):
    url = API + path
    data = None
    headers = {}
    if raw is not None:
        data = raw
        headers['Content-Type'] = ctype
    elif body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = 'Bearer ' + token
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(r, timeout=20)
        text = resp.read().decode()
        return resp.status, (json.loads(text) if text and text.strip().startswith(('{','[')) else text)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def step(n, label):
    print('[' + str(n) + '] ' + label)

def ok(msg):
    print('    OK  ' + msg)

def fail(msg):
    print('    FAIL  ' + msg)
    sys.exit(1)

# --- 1. Driver login -----------------------------------------------------
step(1, 'Driver login  POST /auth/login')
status, body = req('POST', '/auth/login', {'phone': DRIVER_PHONE, 'password': DRIVER_PASSWORD})
if status != 200 and status != 201:
    fail('login status ' + str(status) + ' body=' + str(body))
token = body.get('accessToken') or body.get('token') or body.get('access_token')
operator_id = (body.get('driver') or {}).get('operatorId') or body.get('operatorId')
if not token:
    fail('no token in login response: ' + json.dumps(body))
ok('token acquired; operatorId=' + str(operator_id))

# --- 2. Dispatcher creates order assigned to this driver -----------------
step(2, 'Dispatcher creates order  POST /transport-orders')
ext_ref = 'VERIFY-' + uuid.uuid4().hex[:8]
plan = (datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
create_body = {
    'externalRef': ext_ref,
    'stops': [
        {'sequence': 1, 'stopType': 'pickup'},
        {'sequence': 2, 'stopType': 'dropoff'},
    ],
    'roadRun': {'plannedStartAt': plan, 'assignedOperatorId': operator_id},
}
status, body = req('POST', '/transport-orders', create_body, token=token)
if status not in (200, 201):
    fail('create status ' + str(status) + ' body=' + str(body))
transport_order_id = body['transportOrderId']
road_run_id = body['roadRunId']
if not road_run_id:
    fail('roadRunId is null - roadRun not created')
ok('order ' + ext_ref + '  transportOrderId=' + transport_order_id)
ok('roadRunId=' + road_run_id)

# --- 3. Driver receives the order  GET /transport-orders/assigned --------
step(3, 'Driver receives order  GET /transport-orders/assigned')
status, body = req('GET', '/transport-orders/assigned', token=token)
if status != 200:
    fail('assigned status ' + str(status) + ' body=' + str(body))
rows = body.get('rows', [])
match = [r for r in rows if r['roadRunId'] == road_run_id]
if not match:
    fail('created roadRun ' + road_run_id + ' not in driver assignments')
row = match[0]
if row['state'] != 'planned':
    fail('expected state planned, got ' + row['state'])
if row['externalRef'] != ext_ref:
    fail('externalRef mismatch: ' + str(row['externalRef']))
if len(row['stops']) != 2:
    fail('expected 2 stops, got ' + str(len(row['stops'])))
ok('driver sees roadRun, state=planned, 2 stops, externalRef matches')

# --- 4. Delivery lifecycle  accept -> start -> complete ------------------
step(4, 'Delivery lifecycle  POST /driver/assignments/:id/{accept,start,complete}')
for action, expect in [('accept', 'dispatched'), ('start', 'started'), ('complete', 'completed')]:
    status, body = req('POST', '/driver/assignments/' + road_run_id + '/' + action, token=token)
    if status not in (200, 201):
        fail(action + ' status ' + str(status) + ' body=' + str(body))
    if body.get('state') != expect:
        fail(action + ' -> expected state ' + expect + ', got ' + str(body.get('state')))
    ok(action + ' -> state=' + expect)

# verify final state via assigned list
status, body = req('GET', '/transport-orders/assigned', token=token)
final = [r for r in body.get('rows', []) if r['roadRunId'] == road_run_id]
if final and final[0]['state'] != 'completed':
    fail('post-complete state in assigned list is ' + final[0]['state'])
ok('FSM walk planned->dispatched->started->completed verified')

# --- 5. Photo -> S3  negotiate -> presigned PUT -> commit ----------------
step(5, 'Proof photo -> S3  POST /upload/negotiate -> S3 PUT -> POST /upload/commit')
photo = b'\\x89PNG\\r\\n\\x1a\\n' + b'VERIFY-PROOF-PHOTO-BYTES' * 16
correlation_id = str(uuid.uuid4())
neg_body = {
    'manifestCorrelationId': correlation_id,
    'transportOrderId': transport_order_id,
    'contentType': 'image/png',
    'expectedSizeBytes': len(photo),
}
status, body = req('POST', '/upload/negotiate', neg_body, token=token)
if status not in (200, 201):
    fail('negotiate status ' + str(status) + ' body=' + str(body))
upload_session_id = body['uploadSessionId']
put_url = body['url']
# negotiate returns a presigned URL with the in-network host (localstack:4566);
# this script runs on the host, where that name does not resolve. Rewrite to
# the host-published endpoint so the presigned signature host still matches.
put_url = put_url.replace('://localstack:4566', '://localhost:4566')
s3_key = body['key']
s3_bucket = body['bucket']
ok('negotiated session=' + upload_session_id + '  bucket=' + s3_bucket)
ok('s3 key=' + s3_key)

# presigned PUT of the photo bytes straight to (LocalStack) S3
put = urllib.request.Request(put_url, data=photo, method='PUT',
                             headers={'Content-Type': 'image/png'})
try:
    presp = urllib.request.urlopen(put, timeout=20)
    if presp.status not in (200, 204):
        fail('S3 PUT status ' + str(presp.status))
except urllib.error.HTTPError as e:
    fail('S3 PUT failed: ' + str(e.code) + ' ' + e.read().decode()[:200])
ok('photo bytes uploaded to S3 via presigned URL (' + str(len(photo)) + ' bytes)')

commit_body = {'uploadSessionId': upload_session_id, 'actualSizeBytes': len(photo)}
status, body = req('POST', '/upload/commit', commit_body, token=token)
if status not in (200, 201):
    fail('commit status ' + str(status) + ' body=' + str(body))
ok('commit -> manifestId=' + str(body.get('manifestId')) + ' state=' + str(body.get('state')))

print()
print('ALL STAGES PASSED  --  dispatcher -> driver -> delivery -> photo verified')
print('  transportOrderId : ' + transport_order_id)
print('  roadRunId        : ' + road_run_id)
print('  s3 object        : ' + s3_bucket + '/' + s3_key)
