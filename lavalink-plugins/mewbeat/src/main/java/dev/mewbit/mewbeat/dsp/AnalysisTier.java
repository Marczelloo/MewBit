package dev.mewbit.mewbeat.dsp;

/** How much DSP work a chart analysis may spend: the full tier suits a PC, the light tier a Raspberry Pi. */
public enum AnalysisTier {
    FULL(17, 512, "full"),
    LIGHT(9, 1024, "light");

    private final int hpssKernel;
    private final int pitchHop;
    private final String wireName;

    AnalysisTier(int hpssKernel, int pitchHop, String wireName) {
        this.hpssKernel = hpssKernel;
        this.pitchHop = pitchHop;
        this.wireName = wireName;
    }

    /** Case-insensitive; {@code null} or an unknown name gives {@link #FULL}. */
    public static AnalysisTier parse(String s) {
        if (s != null) {
            for (AnalysisTier tier : values()) {
                if (tier.wireName.equalsIgnoreCase(s.trim())) {
                    return tier;
                }
            }
        }
        return FULL;
    }

    /** Odd size of both HPSS median filters (time and frequency), in frames and bins. */
    public int hpssKernel() {
        return hpssKernel;
    }

    /** Samples between two pitch-tracker frames. */
    public int pitchHop() {
        return pitchHop;
    }

    public String wireName() {
        return wireName;
    }
}
