import type { Region } from "./schema.ts";

/** Lowercase, strip Vietnamese diacritics and punctuation: "TP. Hồ Chí Minh" -> "tp ho chi minh". */
export function foldVietnamese(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type Place = { city: string; region: Region };

// Display name + region per place. Covers provinces (pre- and post-2025 merger
// names) plus towns that commonly host races. Keys are folded forms.
const PLACES: Record<string, Place> = {};

function add(region: Region, city: string, ...aliases: string[]) {
  for (const name of [city, ...aliases]) PLACES[foldVietnamese(name)] = { city, region };
}

// North
add("north", "Hanoi", "Ha Noi", "Hà Nội");
add("north", "Hai Phong", "Hải Phòng");
add("north", "Quang Ninh", "Quảng Ninh");
add("north", "Ha Long", "Hạ Long", "Halong");
add("north", "Bac Ninh", "Bắc Ninh");
add("north", "Bac Giang", "Bắc Giang");
add("north", "Hai Duong", "Hải Dương");
add("north", "Hung Yen", "Hưng Yên");
add("north", "Thai Binh", "Thái Bình");
add("north", "Nam Dinh", "Nam Định");
add("north", "Ha Nam", "Hà Nam");
add("north", "Ninh Binh", "Ninh Bình");
add("north", "Vinh Phuc", "Vĩnh Phúc");
add("north", "Phu Tho", "Phú Thọ");
add("north", "Thai Nguyen", "Thái Nguyên");
add("north", "Bac Kan", "Bắc Kạn");
add("north", "Cao Bang", "Cao Bằng");
add("north", "Lang Son", "Lạng Sơn");
add("north", "Tuyen Quang", "Tuyên Quang");
add("north", "Ha Giang", "Hà Giang");
add("north", "Lao Cai", "Lào Cai");
add("north", "Sa Pa", "Sapa");
add("north", "Yen Bai", "Yên Bái");
add("north", "Mu Cang Chai", "Mù Cang Chải");
add("north", "Lai Chau", "Lai Châu");
add("north", "Dien Bien", "Điện Biên");
add("north", "Son La", "Sơn La");
add("north", "Moc Chau", "Mộc Châu");
add("north", "Hoa Binh", "Hòa Bình", "Hoà Bình");
add("north", "Mai Chau", "Mai Châu");

// Central (incl. Central Highlands)
add("central", "Thanh Hoa", "Thanh Hóa", "Thanh Hoá");
add("central", "Nghe An", "Nghệ An");
add("central", "Vinh");
add("central", "Ha Tinh", "Hà Tĩnh");
add("central", "Quang Binh", "Quảng Bình");
add("central", "Dong Hoi", "Đồng Hới");
add("central", "Phong Nha");
add("central", "Quang Tri", "Quảng Trị");
add("central", "Hue", "Huế", "Thua Thien Hue", "Thừa Thiên Huế");
add("central", "Da Nang", "Đà Nẵng", "Danang");
add("central", "Quang Nam", "Quảng Nam");
add("central", "Hoi An", "Hội An");
add("central", "Quang Ngai", "Quảng Ngãi");
add("central", "Binh Dinh", "Bình Định");
add("central", "Quy Nhon", "Quy Nhơn");
add("central", "Phu Yen", "Phú Yên");
add("central", "Khanh Hoa", "Khánh Hòa", "Khánh Hoà");
add("central", "Nha Trang");
add("central", "Ninh Thuan", "Ninh Thuận");
add("central", "Binh Thuan", "Bình Thuận");
add("central", "Phan Thiet", "Phan Thiết");
add("central", "Mui Ne", "Mũi Né");
add("central", "Kon Tum");
add("central", "Gia Lai");
add("central", "Pleiku");
add("central", "Dak Lak", "Đắk Lắk", "Daklak");
add("central", "Buon Ma Thuot", "Buôn Ma Thuột");
add("central", "Dak Nong", "Đắk Nông");
add("central", "Lam Dong", "Lâm Đồng");
add("central", "Da Lat", "Đà Lạt", "Dalat");

// South
add("south", "Ho Chi Minh City", "Ho Chi Minh", "Hồ Chí Minh", "HCMC", "HCM", "Saigon", "Sài Gòn", "TP HCM", "TPHCM", "TP. HCM", "TP. Hồ Chí Minh");
add("south", "Can Gio", "Cần Giờ");
add("south", "Ba Ria - Vung Tau", "Bà Rịa - Vũng Tàu", "Ba Ria Vung Tau");
add("south", "Vung Tau", "Vũng Tàu");
add("south", "Ho Tram", "Hồ Tràm");
add("south", "Con Dao", "Côn Đảo");
add("south", "Binh Duong", "Bình Dương");
add("south", "Dong Nai", "Đồng Nai");
add("south", "Binh Phuoc", "Bình Phước");
add("south", "Tay Ninh", "Tây Ninh");
add("south", "Long An");
add("south", "Tien Giang", "Tiền Giang");
add("south", "Ben Tre", "Bến Tre");
add("south", "Tra Vinh", "Trà Vinh");
add("south", "Vinh Long", "Vĩnh Long");
add("south", "Dong Thap", "Đồng Tháp");
add("south", "An Giang");
add("south", "Kien Giang", "Kiên Giang");
add("south", "Phu Quoc", "Phú Quốc");
add("south", "Can Tho", "Cần Thơ");
add("south", "Hau Giang", "Hậu Giang");
add("south", "Soc Trang", "Sóc Trăng");
add("south", "Bac Lieu", "Bạc Liêu");
add("south", "Ca Mau", "Cà Mau");

const ADMIN_PREFIX = /^(thanh pho|tp|tinh|province of|city of)\s+/;
const ADMIN_SUFFIX = /\s+(city|province)$/;

export function resolvePlace(raw: string | null | undefined): { city: string | null; region: Region | null } {
  if (!raw || !raw.trim()) return { city: null, region: null };
  // "Thành Phố Đà Lạt, Tỉnh Lâm Đồng": the whole string, then each part, most specific first.
  // Also "Quảng trường Văn Miếu, Phường Cao Lãnh, Tỉnh Đồng Tháp" (a venue), which resolves by its last part.
  for (const part of [raw, ...raw.split(",")]) {
    const folded = foldVietnamese(part);
    const hit = PLACES[folded] ?? PLACES[folded.replace(ADMIN_PREFIX, "").replace(ADMIN_SUFFIX, "")];
    if (hit) return { ...hit };
  }
  return { city: raw.trim(), region: null };
}
