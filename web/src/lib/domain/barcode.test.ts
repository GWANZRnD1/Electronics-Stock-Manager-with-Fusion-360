import { describe, expect, it } from "vitest";

import { EOT, GS, RS, decodeScannedBytes, parseLabel } from "./barcode";

function ecia(...fields: string[]): string {
  return `[)>${RS}06${GS}` + fields.join(GS) + RS + EOT;
}

/** 1 byte → 1 char, for ASCII/control payloads (DataMatrix). */
function latin1Bytes(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

describe("parseLabel", () => {
  it("parses a DigiKey DataMatrix with MPN and quantity", () => {
    const raw = ecia(
      "PMCP2221A-I/SL-ND",
      "1PMCP2221A-I/SL",
      "K0123456",
      "1K9988776",
      "10K1234",
      "Q10",
    );

    const label = parseLabel(raw);

    expect(label.distributor).toBe("digikey");
    expect(label.mpn).toBe("MCP2221A-I/SL");
    expect(label.quantity).toBe(10);
    expect(label.distributorPart).toBe("MCP2221A-I/SL-ND");
    expect(label.labelFormat).toBe("ecia_datamatrix");
  });

  it("identifies Mouser from its malformed header", () => {
    const raw = ">[)>06" + GS + "1PSTM32F103C8T6" + GS + "Q25" + RS + EOT;

    const label = parseLabel(raw);

    expect(label.mpn).toBe("STM32F103C8T6");
    expect(label.quantity).toBe(25);
    expect(label.distributor).toBe("mouser");
    expect(label.labelFormat).toBe("ecia_datamatrix");
  });

  it("identifies Mouser from a stock-number customer part", () => {
    const label = parseLabel(ecia("P595-HMC905LP3ETR", "1PHMC905LP3ETR", "Q2"));

    expect(label.distributor).toBe("mouser");
    expect(label.mpn).toBe("HMC905LP3ETR");
    expect(label.quantity).toBe(2);
  });

  it("identifies DigiKey from packaging suffixes other than -ND", () => {
    expect(parseLabel(ecia("P296-1234-2-CT", "1PABC123", "Q5")).distributor).toBe("digikey");
    expect(parseLabel(ecia("P296-1234-6-TR", "1PABC123", "Q5")).distributor).toBe("digikey");
  });

  it("parses an LCSC QR blob", () => {
    const label = parseLabel(
      "{pbn:PICK2009291337,on:SO2009291337,pc:C312270,pm:STM32F103C8T6,qty:50}",
    );

    expect(label.distributor).toBe("lcsc");
    expect(label.distributorPart).toBe("C312270");
    expect(label.mpn).toBe("STM32F103C8T6");
    expect(label.quantity).toBe(50);
    expect(label.labelFormat).toBe("lcsc_qr");
  });

  it("parses an LCSC QR with quoted keys/values", () => {
    const label = parseLabel('{"pc":"C312270","pm":"STM32F103C8T6","qty":"50"}');

    expect(label.distributor).toBe("lcsc");
    expect(label.distributorPart).toBe("C312270");
    expect(label.mpn).toBe("STM32F103C8T6");
    expect(label.quantity).toBe(50);
  });

  it("parses a bare LCSC C-number", () => {
    const label = parseLabel("C312270");

    expect(label.distributor).toBe("lcsc");
    expect(label.distributorPart).toBe("C312270");
    expect(label.mpn).toBeNull();
  });

  it("treats a bare string as a possible MPN", () => {
    const label = parseLabel("STM32F103C8T6");

    expect(label.distributor).toBe("unknown");
    expect(label.mpn).toBe("STM32F103C8T6");
    expect(label.labelFormat).toBe("bare");
  });

  it.each(["", "   ", "\n\t"])("throws on empty input %j", (bad) => {
    expect(() => parseLabel(bad)).toThrow();
  });

  it("falls back to null quantity when unparseable", () => {
    const label = parseLabel(ecia("1PABC123", "Qmany"));

    expect(label.mpn).toBe("ABC123");
    expect(label.quantity).toBeNull();
  });
});

describe("decodeScannedBytes", () => {
  it("returns the fallback when there are no bytes", () => {
    expect(decodeScannedBytes(undefined, "fallback")).toBe("fallback");
    expect(decodeScannedBytes(new Uint8Array(), "fallback")).toBe("fallback");
  });

  it("preserves ECIA control separators by decoding Latin-1 from bytes", () => {
    // The reader's rendered text dropped the GS/RS separators; bytes keep them.
    const raw = ecia("PMCP2221A-I/SL-ND", "1PMCP2221A-I/SL", "Q10");
    const decoded = decodeScannedBytes(latin1Bytes(raw), "MCP2221A-I/SL Q10");

    expect(decoded).toBe(raw);
    const label = parseLabel(decoded);
    expect(label.distributor).toBe("digikey");
    expect(label.mpn).toBe("MCP2221A-I/SL");
    expect(label.quantity).toBe(10);
  });

  it("decodes a UTF-8 LCSC payload (Chinese product name)", () => {
    const s = "{pc:C123456,pm:电阻 100mm,qty:5}";
    const utf8 = new TextEncoder().encode(s);

    const decoded = decodeScannedBytes(utf8);
    expect(decoded).toBe(s);
    expect(parseLabel(decoded).quantity).toBe(5);
  });

  it("decodes GBK bytes that aren't valid UTF-8", () => {
    // "中" is 0xD6 0xD0 in GBK and not valid UTF-8, so it must use the GBK path.
    const bytes = new Uint8Array([0x7b, 0xd6, 0xd0, 0x7d]); // { 中 }
    expect(decodeScannedBytes(bytes)).toBe("{中}");
  });
});
