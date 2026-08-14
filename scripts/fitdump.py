"""Minimal FIT decoder, just enough to inspect workout / workout_step messages."""
import struct
import sys

BASE_SIZE = {0: 1, 1: 1, 2: 1, 131: 2, 132: 2, 133: 4, 134: 4, 7: 1, 136: 4, 137: 8, 10: 1, 139: 2, 140: 4, 141: 4, 142: 8, 143: 8, 144: 8}
BASE_FMT = {0: "B", 1: "b", 2: "B", 131: "h", 132: "H", 133: "i", 134: "I", 136: "f", 137: "d", 10: "B", 139: "H", 140: "I", 141: "i", 142: "q", 143: "Q"}

WORKOUT = 26
WORKOUT_STEP = 27

STEP_FIELDS = {
    254: "message_index", 0: "wkt_step_name", 1: "duration_type", 2: "duration_value",
    3: "target_type", 4: "target_value", 5: "custom_target_value_low",
    6: "custom_target_value_high", 7: "intensity", 8: "notes", 9: "equipment",
    19: "repeat_steps",
}
WORKOUT_FIELDS = {254: "message_index", 4: "sport", 5: "capabilities", 6: "num_valid_steps", 8: "wkt_name", 11: "sub_sport"}

DURATION_TYPE = {0: "time", 1: "distance", 2: "hr_less_than", 3: "hr_greater_than", 5: "open", 6: "repeat_until_steps_cmplt", 28: "repetition_time"}
TARGET_TYPE = {0: "speed", 1: "heart_rate", 2: "open", 3: "cadence", 4: "power", 11: "power_3s", 13: "power_lap"}
INTENSITY = {0: "active", 1: "rest", 2: "warmup", 3: "cooldown", 4: "recovery", 5: "interval", 6: "other"}


def decode(path):
    data = open(path, "rb").read()
    header_size = data[0]
    pos = header_size
    end = len(data) - 2  # trailing CRC
    definitions = {}
    out = []
    while pos < end:
        header = data[pos]
        pos += 1
        if header & 0x80:  # compressed timestamp header — not used in workout files
            local = (header >> 5) & 0x03
            defn = definitions[local]
            pos = read_data(data, pos, defn, out)
            continue
        local = header & 0x0F
        if header & 0x40:  # definition message
            _reserved = data[pos]
            arch = data[pos + 1]
            endian = "<" if arch == 0 else ">"
            global_num = struct.unpack(endian + "H", data[pos + 2:pos + 4])[0]
            num_fields = data[pos + 4]
            pos += 5
            fields = []
            for _ in range(num_fields):
                fields.append((data[pos], data[pos + 1], data[pos + 2]))
                pos += 3
            dev_fields = []
            if header & 0x20:
                num_dev = data[pos]
                pos += 1
                for _ in range(num_dev):
                    dev_fields.append((data[pos], data[pos + 1], data[pos + 2]))
                    pos += 3
            definitions[local] = (global_num, endian, fields, dev_fields)
        else:
            pos = read_data(data, pos, definitions[local], out)
    return out


def read_data(data, pos, defn, out):
    global_num, endian, fields, dev_fields = defn
    values = {}
    for field_num, size, base_type in fields:
        raw = data[pos:pos + size]
        pos += size
        values[field_num] = parse_value(raw, base_type, endian, size)
    for _, size, _ in dev_fields:
        pos += size
    if global_num in (WORKOUT, WORKOUT_STEP):
        out.append((global_num, values))
    return pos


def parse_value(raw, base_type, endian, size):
    bt = base_type & 0x9F
    if bt == 7:  # string
        return raw.split(b"\x00")[0].decode("utf-8", "replace")
    fmt = BASE_FMT.get(bt)
    if not fmt:
        return raw.hex()
    unit = struct.calcsize(fmt)
    if size == unit:
        return struct.unpack(endian + fmt, raw)[0]
    count = size // unit
    return list(struct.unpack(endian + fmt * count, raw[: unit * count]))


def show(path):
    print(f"--- {path}")
    for global_num, values in decode(path):
        if global_num == WORKOUT:
            named = {WORKOUT_FIELDS.get(k, k): v for k, v in values.items()}
            print("WORKOUT:", named)
            continue
        named = {STEP_FIELDS.get(k, k): v for k, v in values.items()}
        dur_t = DURATION_TYPE.get(named.get("duration_type"), named.get("duration_type"))
        dur_v = named.get("duration_value")
        if dur_t == "time" and isinstance(dur_v, int):
            dur = f"{dur_v / 1000:.0f}s"
        elif dur_t == "distance" and isinstance(dur_v, int):
            dur = f"{dur_v / 100:.0f}m"
        else:
            dur = f"{dur_t}={dur_v}"
        tgt_t = TARGET_TYPE.get(named.get("target_type"), named.get("target_type"))
        low, high = named.get("custom_target_value_low"), named.get("custom_target_value_high")
        target = f"{tgt_t}"
        if isinstance(low, int) and isinstance(high, int) and (low or high):
            if tgt_t == "speed":
                def pace(mms):
                    if not mms:
                        return "0"
                    secs = 1000 / (mms / 1000)
                    return f"{int(secs)//60}:{int(secs)%60:02d}/km"
                target += f" {low}-{high} mm/s ({pace(high)}-{pace(low)})"
            else:
                target += f" {low}-{high}"
        elif named.get("target_value"):
            target += f" zone={named['target_value']}"
        print(
            f"  step {named.get('message_index'):>2} {dur:>8}  target={target:<40} "
            f"intensity={INTENSITY.get(named.get('intensity'), named.get('intensity'))} "
            f"name={named.get('wkt_step_name', '')!r} repeat={named.get('repeat_steps', '')}"
        )


for arg in sys.argv[1:]:
    show(arg)
