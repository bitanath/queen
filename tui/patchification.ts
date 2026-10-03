// Extend the last Mach-O segment (__LINKEDIT) to cover everything up to EOF so
// the appended GGUF + ELTHBLOB trailer fall inside the code region codesign
// hashes. Also relocates __LINKEDIT's vmaddr above the dyld shared cache when
// the extension would overlap it. Runs in place via positional reads/writes, so
// it is safe on multi-GB files (never reads the whole file).
//
//   bun tui/patchification.ts <mach-o>
import { closeSync, fstatSync, openSync, readSync, writeSync } from "node:fs";

const MH_MAGIC_64 = 0xfeedfacf;
const LC_SEGMENT_64 = 0x19;
const PAGE = 0x4000; // arm64 page size

// Extending __LINKEDIT can push its virtual range into the dyld shared cache
// (fixed around 0x180000000 on arm64), which makes launching fail with
// "syscall to map cache into shared region failed". When that would happen we
// move the segment's vmaddr well above the cache. Nothing references
// __LINKEDIT by address (linkedit_data commands all use file offsets), so this
// is safe.
const SHARED_CACHE_LOW = 0x180000000n;
const RELOC_BASE = 0x300000000n;

const HEADER_SIZE = 32;
const SEGMENT_CMD_SIZE = 72;
const SEGNAME_OFF = 8;
const VMADDR_OFF = 24;
const VMSIZE_OFF = 32;
const FILEOFF_OFF = 40;
const FILESIZE_OFF = 48;

function fail(message: string): never {
  console.error(`patchify: ${message}`);
  process.exit(1);
}

function writeU64(fd: number, offset: number, value: bigint): void {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value, 0);
  if (writeSync(fd, buffer, 0, 8, offset) !== 8) fail("short write");
}

function patch(path: string): void {
  const fd = openSync(path, "r+");
  try {
    const size = fstatSync(fd).size;
    const header = Buffer.alloc(HEADER_SIZE);
    if (readSync(fd, header, 0, HEADER_SIZE, 0) !== HEADER_SIZE) fail("short header");
    if (header.readUInt32LE(0) !== MH_MAGIC_64) fail(`not a 64-bit little-endian Mach-O: ${path}`);
    const ncmds = header.readUInt32LE(16);
    const sizeofcmds = header.readUInt32LE(20);
    if (sizeofcmds < 8) fail("empty load commands");

    let off = HEADER_SIZE;
    const end = HEADER_SIZE + sizeofcmds;
    for (let i = 0; i < ncmds; i += 1) {
      if (off + 8 > end) fail("load commands truncated");
      const lc = Buffer.alloc(SEGMENT_CMD_SIZE);
      if (readSync(fd, lc, 0, 8, off) !== 8) fail("short load command");
      const cmd = lc.readUInt32LE(0);
      const cmdsize = lc.readUInt32LE(4);
      if (cmdsize < 8) fail("bad load command size");
      if (cmd === LC_SEGMENT_64) {
        if (readSync(fd, lc, 0, SEGMENT_CMD_SIZE, off) !== SEGMENT_CMD_SIZE) fail("short segment command");
        const segname = lc.subarray(SEGNAME_OFF, SEGNAME_OFF + 16).toString("ascii").replace(/\u0000.*$/, "");
        if (segname === "__LINKEDIT") {
          const vmaddr = lc.readBigUInt64LE(VMADDR_OFF);
          const vmsize = lc.readBigUInt64LE(VMSIZE_OFF);
          const fileoff = lc.readBigUInt64LE(FILEOFF_OFF);
          const filesize = lc.readBigUInt64LE(FILESIZE_OFF);
          const newFilesize = BigInt(size) - fileoff;
          const newVmsize = ((newFilesize + BigInt(PAGE) - 1n) / BigInt(PAGE)) * BigInt(PAGE);
          const newVmaddr = vmaddr + newVmsize > SHARED_CACHE_LOW ? RELOC_BASE : vmaddr;
          console.log(
            `patch executable with the gguf: __LINKEDIT fileoff=${fileoff} filesize ${filesize}->${newFilesize} ` +
              `vmsize ${vmsize}->${newVmsize} vmaddr 0x${vmaddr.toString(16)}->0x${newVmaddr.toString(16)} (eof=${size})`,
          );
          writeU64(fd, off + VMADDR_OFF, newVmaddr);
          writeU64(fd, off + VMSIZE_OFF, newVmsize);
          writeU64(fd, off + FILESIZE_OFF, newFilesize);
          return;
        }
      }
      off += cmdsize;
    }
    fail("__LINKEDIT not found");
  } finally {
    closeSync(fd);
  }
}

const target = process.argv[2];
if (!target) {
  console.error("usage: bun tui/patchification.ts <mach-o>");
  process.exit(2);
}
patch(target);
