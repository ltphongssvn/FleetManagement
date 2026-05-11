// apps/api/src/database/seeds/reference-seed.ts
// Seed reference tables from VẬN CHUYỂN Xe Thùng PDFs.
// Idempotent via ON CONFLICT DO NOTHING on unique constraints.
import type { FleetDb } from '../database.module.js';
import { driver, vehicle, customer, cargoType, warehouse, orderSequence } from '../schema/reference.js';

const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
const TENANCY = {
  companyId: COMPANY_ID,
  businessUnitId: COMPANY_ID,
  depotId: COMPANY_ID,
  legalEntityId: COMPANY_ID,
};

const TRUCKS: ReadonlyArray<{ plate: string; driverName: string | null }> = [
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

const PICKUP_WAREHOUSES: ReadonlyArray<string> = [
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

const DELIVERY_WAREHOUSES: ReadonlyArray<string> = [
  'ĐA NĂNG', 'ĐẠI THÀNH', 'DƯƠNG VŨ', '8 ĐẠT', 'CHỢ GẠO', 'ĐẠI HỮU',
  'HIỀN NGUYỄN', '8 TẺO', '3 ĐỰC',
];

const CARGO_TYPES: ReadonlyArray<string> = ['TẤM', 'CHI', 'CÁM', 'GẠO', 'TRẤU', 'XI MĂNG'];

const CUSTOMERS: ReadonlyArray<string> = ['ĐA NĂNG', 'ĐẠI THÀNH'];

export async function seedReference(db: FleetDb): Promise<void> {
  for (const t of TRUCKS) {
    await db.insert(vehicle).values({ ...TENANCY, plate: t.plate, vehicleType: 'box_truck' }).onConflictDoNothing();
    if (t.driverName) {
      await db.insert(driver).values({ ...TENANCY, fullName: t.driverName }).onConflictDoNothing();
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
  await db.insert(orderSequence).values({ ...TENANCY, prefix: 'XT', nextValue: 1, padWidth: 3 }).onConflictDoNothing();
}
