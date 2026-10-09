/**
 * Canned Sickw answers for test mode (SICKW_TEST_MODE, or no SICKW_API_KEY) —
 * check-in must be exercisable fully offline, and every real Sickw hit costs
 * money from a prepaid balance.
 *
 * Keyed by the LAST DIGIT of the query, so different IMEIs land on different
 * devices and a walkthrough can stage a specific scenario just by choosing an
 * ending: ...0 a clean unlocked iPhone, ...3 a blacklisted one, ...4 FMI ON,
 * ...6 a MacBook looked up by serial. Each fixture is the EXACT shape
 * sickwLookup returns in real mode — { ok, fields, raw } with `fields`
 * literally what parseSickwResult(raw.result) produces (generated from it,
 * not written by hand) — so nothing downstream can tell test mode from a
 * live answer. raw.result deliberately keeps Sickw's HTML-ish
 * "Key: Value<br>" form (object form on the iPad one, since real services
 * answer in either), so the fixtures double as parser test cases.
 */

/** Digit 0/1 — the happy path: clean, unlocked, sellable as-is. */
const CLEAN_IPHONE_15_PRO_MAX = {
  ok: true,
  fields: {
    model_description: "IPHONE 15 PRO MAX NATURAL TITANIUM 256GB-USA",
    model_name: "iPhone 15 Pro Max",
    model_number: "A2849",
    imei: "356303481234560",
    imei2: "356303481234578",
    serial_number: "FFWX2Q9KL0",
    color: "Natural Titanium",
    storage: "256GB",
    warranty_status: "Out Of Warranty",
    estimated_purchase_date: "2023-09-29",
    carrier: "10 - Unlock.",
    country: "United States",
    sim_lock: "Unlocked",
    find_my_iphone: "OFF",
    icloud_status: "Clean",
    blacklist_status: "Clean",
    model: "iPhone 15 Pro Max",
    serial: "FFWX2Q9KL0",
    fmi: "OFF",
    purchase_country: "United States",
    warranty: "Out Of Warranty",
  },
  raw: {
    status: "success",
    imei: "356303481234560",
    id: "91000001",
    price: "0.12",
    balance: "27.75",
    result:
      "Model Description: IPHONE 15 PRO MAX NATURAL TITANIUM 256GB-USA<br>" +
      "Model Name: iPhone 15 Pro Max<br>" +
      "Model Number: A2849<br>" +
      "IMEI: 356303481234560<br>" +
      "IMEI2: 356303481234578<br>" +
      "Serial Number: FFWX2Q9KL0<br>" +
      "Color: Natural Titanium<br>" +
      "Storage: 256GB<br>" +
      "Warranty Status: Out Of Warranty<br>" +
      "Estimated Purchase Date: 2023-09-29<br>" +
      "Carrier: 10 - Unlock.<br>" +
      "Country: United States<br>" +
      'SIM-Lock: <font color="green">Unlocked</font><br>' +
      'Find My iPhone: <font color="green">OFF</font><br>' +
      'iCloud Status: <font color="green">Clean</font><br>' +
      'Blacklist Status: <font color="green">Clean</font>',
  },
};

/**
 * Digit 2/7 — carrier-locked and still being paid off. Clean otherwise; the
 * carrier fact arrives only as Apple's tether policy string, which is how a
 * locked phone often reports it (exercises the next_tether_policy alias).
 */
const ATT_LOCKED_IPHONE_16 = {
  ok: true,
  fields: {
    model_description: "IPHONE 16 BLACK 128GB ATT-USA",
    model_name: "iPhone 16",
    model_number: "A3081",
    imei: "359218771234562",
    imei2: "359218771234570",
    serial_number: "JXKQ2AB0FC",
    color: "Black",
    memory: "128GB",
    warranty_status: "AppleCare+ Active",
    purchase_country: "United States",
    next_tether_policy_description: "US AT&T Locked Policy",
    sim_lock: "Locked",
    financed: "Yes",
    find_my_iphone: "OFF",
    icloud_status: "Clean",
    blacklist_status: "Clean",
    model: "iPhone 16",
    serial: "JXKQ2AB0FC",
    storage: "128GB",
    carrier: "US AT&T Locked Policy",
    fmi: "OFF",
    warranty: "AppleCare+ Active",
  },
  raw: {
    status: "success",
    imei: "359218771234562",
    id: "91000002",
    price: "0.12",
    balance: "27.63",
    result:
      "Model Description: IPHONE 16 BLACK 128GB ATT-USA<br>" +
      "Model Name: iPhone 16<br>" +
      "Model Number: A3081<br>" +
      "IMEI: 359218771234562<br>" +
      "IMEI2: 359218771234570<br>" +
      "Serial Number: JXKQ2AB0FC<br>" +
      "Color: Black<br>" +
      "Memory: 128GB<br>" +
      "Warranty Status: AppleCare+ Active<br>" +
      "Purchase Country: United States<br>" +
      "Next Tether Policy Description: US AT&T Locked Policy<br>" +
      'SIM-Lock: <font color="red">Locked</font><br>' +
      "Financed: Yes<br>" +
      "Find My iPhone: OFF<br>" +
      "iCloud Status: Clean<br>" +
      "Blacklist Status: Clean",
  },
};

/** Digit 3/8 — the do-not-buy answer: reported lost/stolen, GSMA blacklisted. */
const BLACKLISTED_IPHONE_16 = {
  ok: true,
  fields: {
    model_description: "IPHONE 16 ULTRAMARINE 128GB ATT-USA",
    model_name: "iPhone 16",
    model_number: "A3081",
    imei: "359218779876543",
    imei2: "359218779876550",
    serial_number: "KV2N4CD1GQ",
    color: "Ultramarine",
    storage: "128GB",
    carrier: "AT&T US",
    sim_lock: "Locked",
    find_my_iphone: "OFF",
    icloud_status: "Clean",
    blacklist_status: "BLACKLISTED",
    blacklist_reason: "Reported Lost/Stolen",
    blacklisted_by: "AT&T US",
    purchase_country: "United States",
    model: "iPhone 16",
    serial: "KV2N4CD1GQ",
    fmi: "OFF",
  },
  raw: {
    status: "success",
    imei: "359218779876543",
    id: "91000003",
    price: "0.12",
    balance: "27.51",
    result:
      "Model Description: IPHONE 16 ULTRAMARINE 128GB ATT-USA<br>" +
      "Model Name: iPhone 16<br>" +
      "Model Number: A3081<br>" +
      "IMEI: 359218779876543<br>" +
      "IMEI2: 359218779876550<br>" +
      "Serial Number: KV2N4CD1GQ<br>" +
      "Color: Ultramarine<br>" +
      "Storage: 128GB<br>" +
      "Carrier: AT&T US<br>" +
      'SIM-Lock: <font color="red">Locked</font><br>' +
      "Find My iPhone: OFF<br>" +
      "iCloud Status: Clean<br>" +
      'Blacklist Status: <font color="red">BLACKLISTED</font><br>' +
      "Blacklist Reason: Reported Lost/Stolen<br>" +
      "Blacklisted By: AT&T US<br>" +
      "Purchase Country: United States",
  },
};

/** Digit 4/9 — Find My iPhone still ON: fine phone, not transferable yet. */
const FMI_ON_IPHONE_14_PRO = {
  ok: true,
  fields: {
    model_description: "IPHONE 14 PRO DEEP PURPLE 128GB LL/A",
    model_name: "iPhone 14 Pro",
    model_number: "A2650",
    imei: "355086551234584",
    imei2: "355086551234592",
    serial_number: "G6TZ9XY2PH",
    color: "Deep Purple",
    storage: "128GB",
    battery_health: "87%",
    carrier: "10 - Unlock.",
    sim_lock: "Unlocked",
    find_my_iphone: "ON",
    icloud_status: "Clean",
    blacklist_status: "Clean",
    purchase_country: "United States",
    model: "iPhone 14 Pro",
    serial: "G6TZ9XY2PH",
    fmi: "ON",
    battery: "87%",
  },
  raw: {
    status: "success",
    imei: "355086551234584",
    id: "91000004",
    price: "0.12",
    balance: "27.39",
    result:
      "Model Description: IPHONE 14 PRO DEEP PURPLE 128GB LL/A<br>" +
      "Model Name: iPhone 14 Pro<br>" +
      "Model Number: A2650<br>" +
      "IMEI: 355086551234584<br>" +
      "IMEI2: 355086551234592<br>" +
      "Serial Number: G6TZ9XY2PH<br>" +
      "Color: Deep Purple<br>" +
      "Storage: 128GB<br>" +
      "Battery Health: 87%<br>" +
      "Carrier: 10 - Unlock.<br>" +
      "SIM-Lock: Unlocked<br>" +
      'Find My iPhone: <font color="red">ON</font><br>' +
      "iCloud Status: Clean<br>" +
      "Blacklist Status: Clean<br>" +
      "Purchase Country: United States",
  },
};

/**
 * Digit 5 — an iPad, and the OBJECT form of `result`: some Sickw services
 * answer structured JSON instead of the "Key: Value<br>" string, and the
 * fixture set has to cover both parser paths.
 */
const IPAD_AIR_11 = {
  ok: true,
  fields: {
    model_description: "IPAD AIR 11-INCH (M2) WIFI+CELL 128GB SPACE GRAY",
    model_name: "iPad Air 11-inch (M2)",
    model_number: "A2903",
    imei: "356768991234565",
    serial_number: "H4QF7T6JWD",
    color: "Space Gray",
    storage: "128GB",
    warranty_status: "In Warranty",
    purchase_country: "United States",
    sim_lock: "Unlocked",
    find_my_iphone: "OFF",
    icloud_status: "Clean",
    blacklist_status: "Clean",
    model: "iPad Air 11-inch (M2)",
    serial: "H4QF7T6JWD",
    fmi: "OFF",
    warranty: "In Warranty",
  },
  raw: {
    status: "success",
    imei: "356768991234565",
    id: "91000005",
    price: "0.12",
    balance: "27.27",
    result: {
      "Model Description": "IPAD AIR 11-INCH (M2) WIFI+CELL 128GB SPACE GRAY",
      "Model Name": "iPad Air 11-inch (M2)",
      "Model Number": "A2903",
      IMEI: "356768991234565",
      "Serial Number": "H4QF7T6JWD",
      Color: "Space Gray",
      Storage: "128GB",
      "Warranty Status": "In Warranty",
      "Purchase Country": "United States",
      "SIM-Lock": "Unlocked",
      "Find My iPhone": "OFF",
      "iCloud Status": "Clean",
      "Blacklist Status": "Clean",
    },
  },
};

/** Digit 6 — a MacBook: looked up by SERIAL, so no IMEI anywhere in it. */
const MACBOOK_AIR_13_M3 = {
  ok: true,
  fields: {
    model_description: "MACBOOK AIR 13-INCH M3 8C CPU 10C GPU 16GB 512GB MIDNIGHT",
    model_name: "MacBook Air (13-inch, M3, 2024)",
    model_number: "A3113",
    serial_number: "C02XK1ZLJGH6",
    color: "Midnight",
    storage: "512GB",
    warranty_status: "Out Of Warranty",
    estimated_purchase_date: "2024-05-14",
    purchase_country: "United States",
    fmi: "OFF",
    icloud_status: "Clean",
    model: "MacBook Air (13-inch, M3, 2024)",
    serial: "C02XK1ZLJGH6",
    warranty: "Out Of Warranty",
  },
  raw: {
    status: "success",
    imei: "C02XK1ZLJGH6",
    id: "91000006",
    price: "0.12",
    balance: "27.15",
    result:
      "Model Description: MACBOOK AIR 13-INCH M3 8C CPU 10C GPU 16GB 512GB MIDNIGHT<br>" +
      "Model Name: MacBook Air (13-inch, M3, 2024)<br>" +
      "Model Number: A3113<br>" +
      "Serial Number: C02XK1ZLJGH6<br>" +
      "Color: Midnight<br>" +
      "Storage: 512GB<br>" +
      "Warranty Status: Out Of Warranty<br>" +
      "Estimated Purchase Date: 2024-05-14<br>" +
      "Purchase Country: United States<br>" +
      "FMI: OFF<br>" +
      "iCloud Status: Clean",
  },
};

/** Last query digit -> fixture. Every digit answers, so any IMEI "works". */
export const SICKW_FIXTURES = {
  0: CLEAN_IPHONE_15_PRO_MAX,
  1: CLEAN_IPHONE_15_PRO_MAX,
  2: ATT_LOCKED_IPHONE_16,
  3: BLACKLISTED_IPHONE_16,
  4: FMI_ON_IPHONE_14_PRO,
  5: IPAD_AIR_11,
  6: MACBOOK_AIR_13_M3,
  7: ATT_LOCKED_IPHONE_16,
  8: BLACKLISTED_IPHONE_16,
  9: FMI_ON_IPHONE_14_PRO,
};

/**
 * The test-mode answer for a query. Same contract as sickwLookup: an
 * all-digit query of the wrong length is refused the way the real service
 * would refuse it (an IMEI is exactly 15 digits), because the check-in form's
 * error path deserves rehearsal too. Anything with letters is treated as a
 * serial and always answers.
 *
 * @param {string} query  trimmed IMEI or serial
 * @returns {{ ok: true, fields: Record<string,string>, raw: object }
 *         | { ok: false, error: string }}
 */
export function sickwFixture(query) {
  if (/^\d+$/.test(query) && query.length !== 15) {
    return {
      ok: false,
      error: `An IMEI is 15 digits and this is ${query.length}. Check for a missing or extra digit (dial *#06# on the phone to see it).`,
    };
  }
  // Last digit anywhere in the query picks the device; a digitless serial
  // gets the serial-only device, which is what a digitless query looks like.
  const digit = query.match(/(\d)\D*$/)?.[1];
  return SICKW_FIXTURES[digit ?? 6] ?? MACBOOK_AIR_13_M3;
}
