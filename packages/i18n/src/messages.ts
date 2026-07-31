// packages/i18n/src/messages.ts
// Message SSOT for every surface: ops-web and the React Native apps.
//
// WHY THIS PACKAGE EXISTS. apps/ops-web/src/lib/i18n.ts was the dictionary,
// but nothing enforced it, so it decayed to ONE consumer while every other
// site hardcoded its labels -- inline vi ? ... : ... ternaries duplicating
// entries byte-for-byte, and a board heading that was never in the
// dictionary at all and therefore could not localise. Its SUPPORTED_LOCALES
// and DEFAULT_LOCALE had zero consumers repo-wide, which is how the vi/en
// vocabulary drifted into three hand-written copies with nothing failing to
// compile. It also sat under apps/ops-web/src, so no native app could import
// it across the app boundary.
//
// Prescribed, not invented: pnpm-workspace.yaml lists @i18n among the Frozen
// Stack packages. Modelled on @fleet/design-tokens, the other SSOT consumed
// by both web and React Native.
//
// The Vietnamese values are IMMUTABLE PRODUCTION CONTRACTS -- what
// dispatchers read on a live pilot. Rewording one is a production change,
// not a refactor.
import { z } from 'zod';

// Canonical vocabulary defined ONCE. Type and schema both derive from this
// array, so adding a locale is a single edit that fails compilation
// everywhere it must. Passed to z.enum directly: a loosely-typed variable
// collapses inference to string.
export const LOCALES = Object.freeze(['vi', 'en'] as const);
export type Locale = (typeof LOCALES)[number];
export const LocaleSchema = z.enum(LOCALES);

// Vietnamese is the primary user base.
export const DEFAULT_LOCALE: Locale = 'vi';

// AXIS 1, trust boundary: the fleet_locale cookie is untrusted external
// input, so it is Zod-validated rather than checked by hand-rolled equality.
// The previous implementation compared against two literals inline, a third
// place the vocabulary was written out.
export function parseLocale(value: string | undefined | null): Locale {
  const parsed = LocaleSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_LOCALE;
}

// VI is the key SSOT: MessageKey derives from it, and EN is typed
// Record<MessageKey, string>, so a missing or extra English entry is a
// COMPILE error. Previously both dictionaries were hand-written with no
// structural link, and t() took a bare string, so a typo silently rendered
// the raw key to a dispatcher.
export const VI = {
  'app.title': 'Hệ thống điều phối xe',
  'app.signOut': 'Đăng xuất',
  'app.locale.vi': 'Tiếng Việt',
  'app.locale.en': 'English',
  'login.title': 'Đăng nhập',
  'login.username': 'Tên đăng nhập',
  'login.password': 'Mật khẩu',
  'login.submit': 'Đăng nhập',
  'login.submitting': 'Đang đăng nhập…',
  'login.invalid': 'Tên đăng nhập hoặc mật khẩu không đúng',
  'login.required': 'Bắt buộc',
  'board.title': 'Bảng điều phối',
  'board.createOrder': 'Tạo lệnh điều xe',
  'board.col.roadRun': 'Mã chuyến',
  'board.col.state': 'Trạng thái',
  'board.col.driver': 'Tài xế',
  'board.col.vehicle': 'Xe',
  'board.col.plannedStart': 'Thời gian đi',
  'board.col.stops': 'Số điểm',
  'board.col.orders': 'Mã đơn',
  'board.empty': 'Chưa có chuyến nào.',
  'orderForm.title': 'Lệnh điều xe - Tải thùng',
  'orderForm.orderNo': 'Số Lệnh',
  'orderForm.orderDate': 'Ngày điều xe',
  'orderForm.customer': 'Khách hàng',
  'orderForm.cargo': 'Tên hàng',
  'orderForm.vehiclePlate': 'Số xe',
  'orderForm.driverName': 'Tài xế',
  'orderForm.driver': 'Tài xế',
  'orderForm.pickupDate': 'Ngày nhận hàng',
  'orderForm.pickupWarehouse': 'Kho nhận hàng',
  'orderForm.backupWarehouse': 'Kho dự phòng',
  'orderForm.pickup': 'Điểm nhận hàng',
  'orderForm.addPickup': 'Thêm điểm nhận hàng',
  'orderForm.removePickup': 'Xóa điểm nhận hàng',
  'orderForm.maxPickupsHint': 'Tối đa 4 điểm nhận hàng (xếp hàng) trong một ngày.',
  'orderForm.none': 'None',
  'orderForm.addPickupWarehouse': 'Thêm kho nhận hàng',
  'orderForm.addDeliveryWarehouse': 'Thêm kho giao hàng',
  'orderForm.deliveryHint': 'Thông thường một kho giao hàng; có thể thêm nếu cần.',
  'orderForm.deliveryDate': 'Ngày giao hàng',
  'orderForm.deliveryWarehouse': 'Kho giao hàng',
  'orderForm.destination': 'Điểm giao hàng',
  'orderForm.addDestination': 'Thêm điểm giao hàng',
  'orderForm.removeDestination': 'Xóa điểm giao hàng',
  'orderForm.maxDestinationsHint': 'Tối đa 4 điểm giao hàng trong một ngày.',
  'orderForm.submit': 'Tạo lệnh',
  'orderForm.submitting': 'Đang tạo…',
  'orderForm.selectDriver': 'Chọn tài xế…',
} as const;

export type MessageKey = keyof typeof VI;

export const EN: Record<MessageKey, string> = {
  'app.title': 'Fleet Operations',
  'app.signOut': 'Sign out',
  'app.locale.vi': 'Tiếng Việt',
  'app.locale.en': 'English',
  'login.title': 'Sign in',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.invalid': 'Invalid username or password',
  'login.required': 'Required',
  'board.title': 'Dispatch board',
  'board.createOrder': 'Create transport order',
  'board.col.roadRun': 'Road run',
  'board.col.state': 'State',
  'board.col.driver': 'Driver',
  'board.col.vehicle': 'Vehicle',
  'board.col.plannedStart': 'Planned',
  'board.col.stops': 'Stops',
  'board.col.orders': 'Orders',
  'board.empty': 'No road runs.',
  'orderForm.title': 'Transport Order - Box Truck',
  'orderForm.orderNo': 'Order #',
  'orderForm.orderDate': 'Dispatch date',
  'orderForm.customer': 'Customer',
  'orderForm.cargo': 'Cargo',
  'orderForm.vehiclePlate': 'Vehicle plate',
  'orderForm.driverName': 'Driver',
  'orderForm.driver': 'Driver',
  'orderForm.pickupDate': 'Pickup date',
  'orderForm.pickupWarehouse': 'Pickup warehouse',
  'orderForm.backupWarehouse': 'Backup warehouse',
  'orderForm.pickup': 'Pickup',
  'orderForm.addPickup': 'Add pickup',
  'orderForm.removePickup': 'Remove pickup',
  'orderForm.maxPickupsHint': 'Up to 4 pickup warehouses (loadings) in a day.',
  'orderForm.none': 'None',
  'orderForm.addPickupWarehouse': 'Add more loading warehouse',
  'orderForm.addDeliveryWarehouse': 'Add more unloading warehouse',
  'orderForm.deliveryHint': 'Usually one unloading warehouse; add more if needed.',
  'orderForm.deliveryDate': 'Delivery date',
  'orderForm.deliveryWarehouse': 'Delivery warehouse',
  'orderForm.destination': 'Destination',
  'orderForm.addDestination': 'Add destination',
  'orderForm.removeDestination': 'Remove destination',
  'orderForm.maxDestinationsHint': 'Up to 4 destinations in a day.',
  'orderForm.submit': 'Create order',
  'orderForm.submitting': 'Creating…',
  'orderForm.selectDriver': 'Select driver…',
};

const DICTS: Record<Locale, Record<MessageKey, string>> = { vi: VI, en: EN };

// key is MessageKey, not string: a typo is a compile error rather than a raw
// dictionary key rendered to a dispatcher. Every key is present in both
// dictionaries by construction, so no runtime fallback is reachable.
export function t(locale: Locale, key: MessageKey): string {
  return DICTS[locale][key];
}
