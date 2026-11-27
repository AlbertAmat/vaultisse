/**
 * A minimal ZIP writer: builds an archive in memory from a list of files (deflate-compressed, UTF-8 names).
 * Enough for the small exports of the admin portal; not meant for archives near 4 GB or with thousands of entries.
 */
import zlib from "zlib";

export interface ZipEntry {
    name: string;
    data: Buffer;
    /** Modification time; defaults to now. */
    date?: Date;
}

function dosDateTime(date: Date): {time: number; day: number} {
    const year = Math.max(1980, date.getFullYear());
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
}

/**
 * @param entries Files to put in the archive.
 * @returns The ZIP file.
 *
 * @example
 *   const zip = buildZip([{name: "README.txt", data: Buffer.from("hello")}, {name: "data/account.json", data: Buffer.from("{}")}]);
 *   // zip is a Buffer holding a valid .zip with two deflated files; send it with Content-Type: application/zip
 */
export function buildZip(entries: ZipEntry[]): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name, "utf8");
        const compressed = zlib.deflateRawSync(entry.data);
        const crc = zlib.crc32(entry.data);
        const {time, day} = dosDateTime(entry.date ?? new Date());

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6); // UTF-8 file names
        local.writeUInt16LE(8, 8); // deflate
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(day, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(entry.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        locals.push(local, name, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(time, 12);
        central.writeUInt16LE(day, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(entry.data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);

        offset += local.length + name.length + compressed.length;
    }
    const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, ...centrals, end]);
}
