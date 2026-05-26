import { describe, expect, it } from "vitest";

import { EOT, GS, RS, parseLabel } from "./barcode";

function ecia(...fields: string[]): string {
  return `[)>${RS}06${GS}` + fields.join(GS) + RS + EOT;
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

  it("parses a Mouser DataMatrix with a malformed header", () => {
    const raw = ">[)>06" + GS + "1PSTM32F103C8T6" + GS + "Q25" + RS + EOT;

    const label = parseLabel(raw);

    expect(label.mpn).toBe("STM32F103C8T6");
    expect(label.quantity).toBe(25);
    expect(label.distributor).toBe("unknown");
    expect(label.labelFormat).toBe("ecia_datamatrix");
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
