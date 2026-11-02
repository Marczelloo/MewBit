package dev.mewbit.mewbeat;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Minimal Ogg Opus muxer (RFC 3533 / RFC 7845) for one stereo 48 kHz stream.
 *
 * <p>Packets are packed into pages without ever splitting a packet across
 * pages. The granule position of a page is the number of 48 kHz samples in all
 * packets that complete on it or before it (pre-skip samples included, as the
 * RFC counts them). The last page carries the EOS flag.
 */
public final class OggOpusWriter {

    public static final int SAMPLE_RATE = 48_000;
    public static final int PRE_SKIP = 312;
    static final int MAX_SEGMENTS = 255;

    private static final int FLAG_BOS = 0x02;
    private static final int FLAG_EOS = 0x04;
    private static final int[] CRC_TABLE = crcTable();

    private final int serial;
    private final ByteArrayOutputStream out = new ByteArrayOutputStream(1 << 20);
    /** Packets of the page being filled. */
    private final ByteArrayOutputStream pageData = new ByteArrayOutputStream(1 << 16);

    private final byte[] segmentTable = new byte[MAX_SEGMENTS];
    private int segmentCount;
    private long granule;
    private int sequence;
    /** The newest finished audio page is held back so that finish() can flag it as the last one. */
    private byte[] heldPage;
    private boolean finished;

    public OggOpusWriter(int serial) {
        this.serial = serial;
        writeHeaders();
    }

    private void writeHeaders() {
        byte[] head = new byte[19];
        System.arraycopy("OpusHead".getBytes(StandardCharsets.US_ASCII), 0, head, 0, 8);
        head[8] = 1; // version
        head[9] = 2; // channels
        putLe16(head, 10, PRE_SKIP);
        putLe32(head, 12, SAMPLE_RATE);
        putLe16(head, 16, 0); // output gain
        head[18] = 0; // channel mapping family 0
        byte[] headPage = page(FLAG_BOS, 0, sequence++, lacing(head.length), head, 0, head.length);
        out.write(headPage, 0, headPage.length);

        byte[] vendor = "mewbeat".getBytes(StandardCharsets.US_ASCII);
        byte[] tags = new byte[8 + 4 + vendor.length + 4];
        System.arraycopy("OpusTags".getBytes(StandardCharsets.US_ASCII), 0, tags, 0, 8);
        putLe32(tags, 8, vendor.length);
        System.arraycopy(vendor, 0, tags, 12, vendor.length);
        putLe32(tags, 12 + vendor.length, 0); // no user comments
        byte[] tagsPage = page(0, 0, sequence++, lacing(tags.length), tags, 0, tags.length);
        out.write(tagsPage, 0, tagsPage.length);
    }

    /** Adds one Opus packet (one 20 ms frame from lavaplayer). */
    public void addPacket(byte[] packet) {
        if (finished) {
            throw new IllegalStateException("writer is finished");
        }
        int segments = packet.length / 255 + 1;
        if (segments > MAX_SEGMENTS) {
            throw new IllegalArgumentException("opus packet too large: " + packet.length);
        }
        if (segmentCount + segments > MAX_SEGMENTS) {
            flushPage();
        }
        for (int i = 0; i < packet.length / 255; i++) {
            segmentTable[segmentCount++] = (byte) 255;
        }
        segmentTable[segmentCount++] = (byte) (packet.length % 255);
        pageData.write(packet, 0, packet.length);
        granule += packetSamples(packet);
    }

    /** Ends the stream and returns the whole file. */
    public byte[] finish() {
        if (finished) {
            throw new IllegalStateException("writer is finished");
        }
        if (segmentCount > 0) {
            flushPage();
        }
        if (heldPage == null) {
            // No audio at all: an empty last page still has to carry EOS.
            heldPage = page(0, granule, sequence++, new byte[0], new byte[0], 0, 0);
        }
        heldPage[5] |= FLAG_EOS;
        stampCrc(heldPage);
        out.write(heldPage, 0, heldPage.length);
        heldPage = null;
        finished = true;
        return out.toByteArray();
    }

    private void flushPage() {
        if (heldPage != null) {
            out.write(heldPage, 0, heldPage.length);
        }
        byte[] table = java.util.Arrays.copyOf(segmentTable, segmentCount);
        byte[] data = pageData.toByteArray();
        heldPage = page(0, granule, sequence++, table, data, 0, data.length);
        pageData.reset();
        segmentCount = 0;
    }

    private byte[] page(
            int flags, long granulePosition, int pageSequence, byte[] table, byte[] data, int off, int len) {
        byte[] page = new byte[27 + table.length + len];
        page[0] = 'O';
        page[1] = 'g';
        page[2] = 'g';
        page[3] = 'S';
        page[4] = 0; // stream structure version
        page[5] = (byte) flags;
        for (int i = 0; i < 8; i++) {
            page[6 + i] = (byte) (granulePosition >>> (8 * i));
        }
        putLe32(page, 14, serial);
        putLe32(page, 18, pageSequence);
        // 22..25: CRC, stamped below
        page[26] = (byte) table.length;
        System.arraycopy(table, 0, page, 27, table.length);
        System.arraycopy(data, off, page, 27 + table.length, len);
        stampCrc(page);
        return page;
    }

    private static byte[] lacing(int length) {
        byte[] table = new byte[length / 255 + 1];
        for (int i = 0; i < table.length - 1; i++) {
            table[i] = (byte) 255;
        }
        table[table.length - 1] = (byte) (length % 255);
        return table;
    }

    private static void stampCrc(byte[] page) {
        page[22] = page[23] = page[24] = page[25] = 0;
        putLe32(page, 22, crc(page, 0, page.length));
    }

    /** Ogg CRC-32: polynomial 0x04c11db7, MSB first, initial 0, no final xor. */
    public static int crc(byte[] data, int off, int len) {
        int crc = 0;
        for (int i = off; i < off + len; i++) {
            crc = (crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ data[i]) & 0xff];
        }
        return crc;
    }

    private static int[] crcTable() {
        int[] table = new int[256];
        for (int i = 0; i < 256; i++) {
            int r = i << 24;
            for (int bit = 0; bit < 8; bit++) {
                r = (r & 0x80000000) != 0 ? (r << 1) ^ 0x04c11db7 : r << 1;
            }
            table[i] = r;
        }
        return table;
    }

    /** Samples at 48 kHz in one Opus packet, from its TOC byte (RFC 6716 section 3.1). */
    public static int packetSamples(byte[] packet) {
        if (packet.length == 0) {
            return 0;
        }
        int toc = packet[0] & 0xff;
        int config = toc >> 3;
        int frameSize; // samples at 48 kHz
        if (config >= 16) {
            frameSize = new int[] {120, 240, 480, 960}[config & 3]; // CELT: 2.5, 5, 10, 20 ms
        } else if (config >= 12) {
            frameSize = (config & 1) == 0 ? 480 : 960; // hybrid: 10, 20 ms
        } else {
            frameSize = new int[] {480, 960, 1920, 2880}[config & 3]; // SILK: 10, 20, 40, 60 ms
        }
        int frames;
        switch (toc & 3) {
            case 0 -> frames = 1;
            case 1, 2 -> frames = 2;
            default -> frames = packet.length < 2 ? 0 : packet[1] & 0x3f;
        }
        return frames * frameSize;
    }

    private static void putLe16(byte[] target, int off, int value) {
        target[off] = (byte) value;
        target[off + 1] = (byte) (value >>> 8);
    }

    private static void putLe32(byte[] target, int off, int value) {
        for (int i = 0; i < 4; i++) {
            target[off + i] = (byte) (value >>> (8 * i));
        }
    }
}
