import { describe, expect, it } from "vitest";

import { bomToText, parseBomText } from "./bomText";

describe("parseBomText", () => {
  it("parses a plain 5-field line", () => {
    const [line] = parseBomText("MCP2221A-I/SL, 1, , SOIC-14, U1");

    expect(line.partMpn).toBe("MCP2221A-I/SL");
    expect(line.qtyPerBoard).toBe(1);
    expect(line.value).toBe("");
    expect(line.package).toBe("SOIC-14");
    expect(line.designators).toBe("U1");
  });

  it("keeps a comma inside the MPN instead of reading it as the quantity", () => {
    // Jauch 32.768 kHz crystal — the MPN's "0,032768" is a decimal-comma value.
    const [line] = parseBomText(
      "Q 0,032768-JTX310-9-10-T2-HMR-LF, 1, 32.7680KHZ, CRYSTAL_320X150X90-2, X1",
    );

    expect(line.partMpn).toBe("Q 0,032768-JTX310-9-10-T2-HMR-LF");
    expect(line.qtyPerBoard).toBe(1); // not 32768
    expect(line.value).toBe("32.7680KHZ");
    expect(line.package).toBe("CRYSTAL_320X150X90-2");
    expect(line.designators).toBe("X1");
  });

  it("defaults quantity to at least 1 and skips blank lines", () => {
    const lines = parseBomText("R-10K, 0, 10k, 0603, R1\n\n  \nC-100N, 2");

    expect(lines).toHaveLength(2);
    expect(lines[0].qtyPerBoard).toBe(1); // 0 floored up to 1
    expect(lines[1].partMpn).toBe("C-100N");
    expect(lines[1].qtyPerBoard).toBe(2);
    expect(lines[1].designators).toBe("");
  });
});

describe("bomToText", () => {
  it("preserves a comma'd MPN and strips commas from the other fields", () => {
    const text = bomToText([
      {
        partMpn: "Q 0,032768-JTX310-9-10-T2-HMR-LF",
        qtyPerBoard: 1,
        value: "32.7680KHZ",
        package: "CRYSTAL_320X150X90-2",
        designators: "X1",
      },
    ]);

    expect(text).toBe("Q 0,032768-JTX310-9-10-T2-HMR-LF, 1, 32.7680KHZ, CRYSTAL_320X150X90-2, X1");
  });

  it("collapses comma-joined designators to a space-separated list", () => {
    const text = bomToText([
      { partMpn: "C-100N", qtyPerBoard: 4, value: "100nF", package: "0402", designators: "C1,C2,C3,C4" },
    ]);

    expect(text).toBe("C-100N, 4, 100nF, 0402, C1 C2 C3 C4");
  });

  it("round-trips a comma'd MPN losslessly through parse → serialize → parse", () => {
    const original =
      "Q 0,032768-JTX310-9-10-T2-HMR-LF, 1, 32.7680KHZ, CRYSTAL_320X150X90-2, X1\nC-100N, 4, 100nF, 0402, C1 C2 C3 C4";
    const reparsed = parseBomText(bomToText(parseBomText(original)));

    expect(reparsed[0].partMpn).toBe("Q 0,032768-JTX310-9-10-T2-HMR-LF");
    expect(reparsed[0].qtyPerBoard).toBe(1);
    expect(reparsed[1].partMpn).toBe("C-100N");
    expect(reparsed[1].qtyPerBoard).toBe(4);
    expect(reparsed[1].designators).toBe("C1 C2 C3 C4");
  });
});
