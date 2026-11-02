package dev.mewbit.mewbeat;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

class OggOpusWriterTest {

    private static final int SERIAL = 0x1234abcd;

    private record Page(int flags, long granule, int serial, int sequence, int crc, byte[] table, byte[] data, byte[] raw) {}

    /** Straightforward bitwise Ogg CRC, independent of the table in the writer. */
    private static int referenceCrc(byte[] bytes) {
        int crc = 0;
        for (byte b : bytes) {
            crc ^= (b & 0xff) << 24;
            for (int i = 0; i < 8; i++) {
                crc = (crc & 0x80000000) != 0 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
            }
        }
        return crc;
    }

    private static int le32(byte[] b, int off) {
        return (b[off] & 0xff) | (b[off + 1] & 0xff) << 8 | (b[off + 2] & 0xff) << 16 | (b[off + 3] & 0xff) << 24;
    }

    private static List<Page> parse(byte[] file) {
        List<Page> pages = new ArrayList<>();
        int pos = 0;
        while (pos < file.length) {
            assertEquals("OggS", new String(file, pos, 4, StandardCharsets.US_ASCII));
            assertEquals(0, file[pos + 4]);
            long granule = 0;
            for (int i = 7; i >= 0; i--) {
                granule = granule << 8 | (file[pos + 6 + i] & 0xff);
            }
            int segments = file[pos + 26] & 0xff;
            byte[] table = Arrays.copyOfRange(file, pos + 27, pos + 27 + segments);
            int dataLength = 0;
            for (byte s : table) {
                dataLength += s & 0xff;
            }
            int end = pos + 27 + segments + dataLength;
            pages.add(new Page(
                    file[pos + 5] & 0xff,
                    granule,
                    le32(file, pos + 14),
                    le32(file, pos + 18),
                    le32(file, pos + 22),
                    table,
                    Arrays.copyOfRange(file, pos + 27 + segments, end),
                    Arrays.copyOfRange(file, pos, end)));
            pos = end;
        }
        return pages;
    }

    private static byte[] celtPacket(int length) {
        byte[] packet = new byte[length];
        packet[0] = (byte) 0xFC; // config 31 (CELT fullband, 20 ms), code 0: one frame
        return packet;
    }

    @Test
    void headerPagesCarryOpusHeadAndOpusTags() {
        List<Page> pages = parse(new OggOpusWriter(SERIAL).finish());

        Page head = pages.get(0);
        assertEquals(0x02, head.flags()); // BOS
        assertEquals(0, head.granule());
        assertEquals(0, head.sequence());
        assertEquals(SERIAL, head.serial());
        byte[] expected = {
            'O', 'p', 'u', 's', 'H', 'e', 'a', 'd',
            1, // version
            2, // channels
            (byte) 312, (byte) (312 >> 8), // pre-skip, little endian
            (byte) 0x80, (byte) 0xBB, 0, 0, // 48000
            0, 0, // output gain
            0 // mapping family
        };
        assertArrayEquals(expected, head.data());

        Page tags = pages.get(1);
        assertEquals(0, tags.flags());
        assertEquals(0, tags.granule());
        assertEquals(1, tags.sequence());
        ByteArrayOutputStream expectedTags = new ByteArrayOutputStream();
        expectedTags.writeBytes("OpusTags".getBytes(StandardCharsets.US_ASCII));
        expectedTags.writeBytes(new byte[] {7, 0, 0, 0});
        expectedTags.writeBytes("mewbeat".getBytes(StandardCharsets.US_ASCII));
        expectedTags.writeBytes(new byte[] {0, 0, 0, 0});
        assertArrayEquals(expectedTags.toByteArray(), tags.data());
    }

    @Test
    void crcMatchesTheBitwiseReference() {
        byte[] zeros = new byte[27];
        zeros[0] = 'O';
        zeros[1] = 'g';
        zeros[2] = 'g';
        zeros[3] = 'S';
        assertEquals(referenceCrc(zeros), OggOpusWriter.crc(zeros, 0, zeros.length));
        assertEquals(0, OggOpusWriter.crc(new byte[10], 0, 10));
    }

    @Test
    void everyPageHasAValidCrc() {
        OggOpusWriter writer = new OggOpusWriter(SERIAL);
        for (int i = 0; i < 700; i++) {
            writer.addPacket(celtPacket(40 + i % 300));
        }
        List<Page> pages = parse(writer.finish());
        assertTrue(pages.size() > 3);
        for (Page page : pages) {
            byte[] zeroed = page.raw().clone();
            zeroed[22] = zeroed[23] = zeroed[24] = zeroed[25] = 0;
            assertEquals(referenceCrc(zeroed), page.crc());
        }
    }

    @Test
    void granuleIsTheSumOfTocSampleCounts() {
        OggOpusWriter writer = new OggOpusWriter(SERIAL);
        for (int i = 0; i < 10; i++) {
            writer.addPacket(celtPacket(100));
        }
        List<Page> pages = parse(writer.finish());

        assertEquals(3, pages.size());
        assertEquals(10 * 960L, pages.get(2).granule());
    }

    @Test
    void tocSampleCounts() {
        assertEquals(960, OggOpusWriter.packetSamples(new byte[] {(byte) 0xFC}));
        assertEquals(120, OggOpusWriter.packetSamples(new byte[] {(byte) 0xE0})); // CELT 2.5 ms (config 28)
        assertEquals(480, OggOpusWriter.packetSamples(new byte[] {0x00})); // SILK 10 ms
        assertEquals(2880, OggOpusWriter.packetSamples(new byte[] {0x18})); // SILK 60 ms (config 3)
        assertEquals(2 * 960, OggOpusWriter.packetSamples(new byte[] {(byte) 0xFD, 0}));
        assertEquals(3 * 960, OggOpusWriter.packetSamples(new byte[] {(byte) 0xFF, 3}));
    }

    @Test
    void longPacketsUseLacingValuesAndStayOnOnePage() {
        OggOpusWriter writer = new OggOpusWriter(SERIAL);
        writer.addPacket(celtPacket(600));
        List<Page> pages = parse(writer.finish());

        Page audio = pages.get(2);
        assertArrayEquals(new byte[] {(byte) 255, (byte) 255, 90}, audio.table());
        assertEquals(600, audio.data().length);
    }

    @Test
    void anExactMultipleOf255EndsWithAZeroSegment() {
        OggOpusWriter writer = new OggOpusWriter(SERIAL);
        writer.addPacket(celtPacket(255));
        Page audio = parse(writer.finish()).get(2);
        assertArrayEquals(new byte[] {(byte) 255, 0}, audio.table());
    }

    @Test
    void aPageHoldsAtMost255SegmentsAndNeverSplitsAPacket() {
        OggOpusWriter writer = new OggOpusWriter(SERIAL);
        for (int i = 0; i < 300; i++) {
            writer.addPacket(celtPacket(1));
        }
        List<Page> pages = parse(writer.finish());

        assertEquals(4, pages.size());
        assertEquals(255, pages.get(2).table().length);
        assertEquals(45, pages.get(3).table().length);
        assertEquals(255 * 960L, pages.get(2).granule());
        assertEquals(300 * 960L, pages.get(3).granule());

        // A packet that does not fit in the remaining segments starts the next page.
        OggOpusWriter split = new OggOpusWriter(SERIAL);
        for (int i = 0; i < 254; i++) {
            split.addPacket(celtPacket(1));
        }
        split.addPacket(celtPacket(600)); // needs 3 segments, only 1 left
        List<Page> splitPages = parse(split.finish());
        assertEquals(254, splitPages.get(2).table().length);
        assertArrayEquals(new byte[] {(byte) 255, (byte) 255, 90}, splitPages.get(3).table());
    }

    @Test
    void onlyTheLastPageIsFlaggedEosAndSequenceNumbersCount() {
        OggOpusWriter writer = new OggOpusWriter(SERIAL);
        for (int i = 0; i < 600; i++) {
            writer.addPacket(celtPacket(1));
        }
        List<Page> pages = parse(writer.finish());

        for (int i = 0; i < pages.size(); i++) {
            assertEquals(i, pages.get(i).sequence());
            assertEquals(i == pages.size() - 1 ? 0x04 : (i == 0 ? 0x02 : 0), pages.get(i).flags());
        }
    }

    @Test
    void anEmptyStreamStillEndsWithAnEosPage() {
        List<Page> pages = parse(new OggOpusWriter(SERIAL).finish());
        assertEquals(3, pages.size());
        assertEquals(0x04, pages.get(2).flags());
    }

    @Test
    void writesAnAllZeroBufferAsOneSilent20msFrame() {
        OggOpusWriter writer = new OggOpusWriter(SERIAL);
        writer.addPacket(new byte[1568]);
        List<Page> pages = parse(writer.finish());

        Page audio = pages.get(2);
        assertArrayEquals(OggOpusWriter.OPUS_SILENCE, audio.data());
        assertEquals(960, audio.granule());
    }
}
