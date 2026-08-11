// apps/api/src/database/seeds/reference-seed.ts
// Seed reference tables from VẬN CHUYỂN Xe Thùng PDFs.
// Idempotent via ON CONFLICT DO NOTHING on unique constraints.
//
// DRIVER NAMES ARE NORMALIZED AND CONFLICT-TARGETED (2026-08-10). This seed
// caused a production incident that a dispatcher experienced as "I delete the
// driver and it comes back forever":
//
//   The real NGUYEN AN BINH DUC was stored with a TRAILING SPACE (a row
//   predating normalizeDisplayName). This loop inserted the canonical literal
//   RAW -- fullName: t.driverName, no schema -- with a bare
//   onConflictDoNothing() carrying NO TARGET. lower(full_name) therefore did
//   not match, no conflict was detected, and a SECOND active row was created:
//   name only, no phone, no vehicle, no device. main.ts runs this seed on
//   EVERY boot when DB_AUTO_MIGRATE=true, and its isProduction flag gates only
//   the login driver, never the TRUCKS loop. Soft-deleting the twin set
//   active=false, which drops it out of the partial unique index, so the next
//   deploy inserted it again.
//
// Two changes close it at the source. Names now pass through
// normalizeDisplayName, the same domain SSOT the create/update services use,
// so the seed cannot introduce a non-canonical spelling. And the driver insert
// declares its conflict target explicitly, so ON CONFLICT resolves against the
// driver identity rather than silently degrading to a blind insert.
//
// This is defense in depth, not the only guard: migration 20260810180000 adds
// a CHECK that REFUSES a non-canonical full_name outright, and the unique index
// now folds over the canonical form. Normalizing here matters because the seed
// runs BEFORE the app listens -- a future edit adding a stray space would
// otherwise fail the CHECK and take the API down at boot rather than being
// quietly corrected.
import bcrypt from 'bcryptjs';
import type { FleetDb } from '../database.module.js';
import { normalizeDisplayName } from '@fleet/domain';
import { driver, vehicle, customer, cargoType, warehouse, orderSequence } from '../schema/reference.js';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
const TENANCY = {
  companyId: COMPANY_ID,
  businessUnitId: COMPANY_ID,
  depotId: COMPANY_ID,
  legalEntityId: COMPANY_ID,
};
// Login-capable pilot driver so the deployed API's real JWT /auth/login
// flow can authenticate the mobile app end-to-end. bcrypt cost 10.
const LOGIN_DRIVERS: readonly {
  fullName: string;
  phone: string;
  password: string;
  operatorId: string;
}[] = [
  {
    fullName: 'TÀI XẾ THỬ NGHIỆM 1',
    phone: '0900000001',
    password: 'driver1pass', // pragma: allowlist secret
    operatorId: '00000000-0000-0000-0000-000000000001',
  },
];
const TRUCKS: readonly { plate: string; driverName: string | null }[] = [
  { plate: '62H 05194', driverName: 'NGUYỄN THANH PHONG' },
  { plate: '62H 05800', driverName: 'NGUYỄN THÀNH ĐỨC' },
  { plate: '62H 05809', driverName: 'NGUYỄN HỮU TÂM' },
  { plate: '62H 05817', driverName: 'LÊ VĂN CHÂU' },
  { plate: '62H 05835', driverName: 'TRẦN HOÀNG HUY' },
  { plate: '62H 05840', driverName: 'LÊ CÔNG THỊNH' },
  { plate: '62H 05844', driverName: 'TRẦN MINH TÂM' },
  { plate: '62H 05851', driverName: 'LÊ ĐỨC ANH' },
  { plate: '62H 05862', driverName: 'NGUYỄN HUY KHÁNH' },
  { plate: '62H 05864', driverName: 'NGUYỄN VĂN GIÀU' },
  { plate: '62H 05887', driverName: 'LÊ CÔNG THỊNH' },
  { plate: '62H 05891', driverName: 'HÀ VĂN HẢI' },
  { plate: '62H 05894', driverName: 'ĐẶNG MINH TIẾN' },
  { plate: '62H 05897', driverName: null },
  { plate: '62H 06120', driverName: null },
  { plate: '62H 06170', driverName: null },
  { plate: '62H 06177', driverName: 'LÊ THANH THUẬN' },
  { plate: '62H 06204', driverName: 'TRẦN HUÊ THÀNH' },
  { plate: '62H 06209', driverName: 'NGUYỄN AN BÌNH ĐỨC' },
  { plate: '62H 06230', driverName: 'LÊ VĂN BẢO' },
  { plate: '62H 06247', driverName: 'TRẦN HOÀNG HẬN' },
  { plate: '62H 06251', driverName: 'LƯƠNG QUỐC SANG' },
  { plate: '62H 06252', driverName: 'LÒ VĂN TÙNG' },
  { plate: '62H 06295', driverName: 'NGUYỄN VĂN THẲNG' },
  { plate: '70H 08777', driverName: 'MAI HIỀN DIỆU' },
];
const PICKUP_WAREHOUSES: readonly string[] = [
  'Cần Thơ', 'Chơn Chính', 'Cường Thắng ( Cần Thơ )', 'Cường Thắng ( Kiến Tường )',
  'Đức Tài', 'Hậu Thạnh Đông', 'Hiệp Hưng ( Tam Nông )',
  'Lương Thực ( Bình Minh Đồng Tháp )', 'Lương Thực ( Đồng Tháp )',
  'Lương Thực ( Lai Vung Đồng Tháp )', 'Lương Thực ( Thanh Bình ĐT )',
  'Lương Thực 1 ( Đồng Tháp )', 'Mecofood', 'Mêkong ( Lai Vung )',
  'Mêkong ( Lấp Vò )', 'Mêkong ( Tiền Giang )', 'Mêkong + Quân Thụy ( Lai Vung )',
  'Ngọc Phương Nam', 'Ngôi Sao', 'Phú An ( Lương Thực Miền Bắc Đồng Tháp )',
  'Phú An ( Mêkong Lai Vung )', 'Quân Thuỵ ( Đồng Tháp )', 'Quốc Doanh 1',
  'Quốc Doanh 2', 'T&T ( Cần Thơ )', 'T&T ( Sa Đéc )', 'Tam Lộc',
  'Tâm Thành Phát ( Cái Bè )', 'Thốt Nốt', 'Trí Mai', 'Út Hạnh',
  'Vĩnh Hưng', 'XN Tân Thạnh',
];
const DELIVERY_WAREHOUSES: readonly string[] = [
  'ĐA NĂNG', 'ĐẠI THÀNH', 'DƯƠNG VŨ', '8 ĐẠT', 'CHỢ GẠO', 'ĐẠI HỮU',
  'HIỀN NGUYỄN', '8 TẺO', '3 ĐỰC',
];
const CARGO_TYPES: readonly string[] = ['TẤM', 'CHI', 'CÁM', 'GẠO', 'TRẤU', 'XI MĂNG'];
const CUSTOMERS: readonly string[] = ['ĐA NĂNG', 'ĐẠI THÀNH'];
export interface SeedOptions {
  // 2026 best practice: seed/test fixtures must be environment-specific and
  // NEVER seeded into production. The login-capable test driver exists only
  // for local mobile /auth/login testing. Defaults to non-production so dev,
  // test, and CI keep the login driver; main.ts passes isProduction=true on
  // Railway so production never gets it.
  readonly isProduction?: boolean;
}
export async function seedReference(db: FleetDb, opts: SeedOptions = {}): Promise<void> {
  const loginDrivers = opts.isProduction === true ? [] : LOGIN_DRIVERS;
  for (const d of loginDrivers) {
    const passwordHash = await bcrypt.hash(d.password, 10);
    const fullName = normalizeDisplayName(d.fullName);
    // Upsert on the (company_id, phone) unique constraint so a pre-existing
    // row with a stale password hash is corrected on every boot — the seed
    // is authoritative for the pilot login driver's credentials.
    await db.insert(driver).values({
      ...TENANCY,
      fullName,
      phone: d.phone,
      passwordHash,
      operatorId: d.operatorId,
    }).onConflictDoUpdate({
      target: [driver.companyId, driver.phone],
      set: { fullName, passwordHash, operatorId: d.operatorId, active: true },
    });
  }
  for (const t of TRUCKS) {
    await db.insert(vehicle).values({ ...TENANCY, plate: t.plate, vehicleType: 'box_truck' }).onConflictDoNothing();
    if (t.driverName) {
      // Normalize before writing, and TARGET the conflict. The previous bare
      // onConflictDoNothing() named no target, so it could not resolve against
      // the driver identity at all -- which is how a look-alike twin was
      // inserted on every boot. Targeting (company_id, full_name) makes the
      // do-nothing meaningful now that both sides are canonical.
      await db.insert(driver)
        .values({ ...TENANCY, fullName: normalizeDisplayName(t.driverName) })
        .onConflictDoNothing({ target: [driver.companyId, driver.fullName] });
    }
  }
  for (const w of PICKUP_WAREHOUSES) {
    await db.insert(warehouse).values({ ...TENANCY, name: w, role: 'pickup' }).onConflictDoNothing();
  }
  for (const w of DELIVERY_WAREHOUSES) {
    await db.insert(warehouse).values({ ...TENANCY, name: w, role: 'delivery' }).onConflictDoNothing();
  }
  for (const c of CARGO_TYPES) {
    await db.insert(cargoType).values({ ...TENANCY, name: c }).onConflictDoNothing();
  }
  for (const c of CUSTOMERS) {
    await db.insert(customer).values({ ...TENANCY, name: c }).onConflictDoNothing();
  }
  await db.insert(orderSequence).values({ ...TENANCY, prefix: 'XTT', nextValue: 1, padWidth: 3 }).onConflictDoNothing();
}
