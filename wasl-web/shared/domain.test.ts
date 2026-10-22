import { describe, it, expect } from "vitest";
import {
  phone,
  tracking,
  trackings,
  sheetStatus,
  advance,
  postal,
  csv,
  sheetId,
} from "./domain";
describe("reconciliation", () => {
  it("matches international and Arabic digits", () => {
    expect(phone("٠١٠ ١٢٣٤ ٥٦٧٨")).toBe("+201012345678");
    expect(phone("+20 10 1234 5678")).toBe("+201012345678");
    expect(phone("00201012345678")).toBe("+201012345678");
  });
  it("recognizes confirmation spelling and case", () => {
    for (const s of [
      " تم التأكيد ",
      "تم التاكيد",
      "مُؤَكَّد",
      "Confirmed",
      "CONFIRMED",
      "Paid",
    ])
      expect(sheetStatus(s)).toBe("confirmed");
    expect(sheetStatus("غير معروف")).toBeNull();
  });
  it("never regresses shipped or final states during import", () => {
    expect(advance("shipped", "confirmed")).toBe("shipped");
    expect(advance("new", "confirmed")).toBe("confirmed");
    expect(advance("delivered", "shipped")).toBe("delivered");
  });
  it("repairs OCR only inside numeric tracking portion", () => {
    expect(tracking("ENO12345678EG")).toBe("EN012345678EG");
    expect(tracking("EN012EG")).toBeNull();
  });
  it("reads ENO and EN0 identically in real SMS layouts without changing prefixes", () => {
    for (const raw of [
      "ENO12345678EG",
      "en012345678eg",
      "EN\u200fO١٢٣٤٥٦٧٨EG",
      "EN\nO1234 5678 EG",
    ])
      expect(
        trackings(
          `عميلنا العزيز تم تسليم شحنتك رقم ${raw} وتم إيداع مبلغ في حسابك`,
        ),
      ).toEqual(["EN012345678EG"]);
    expect(tracking("EBO12345678EG")).toBe("EB012345678EG");
    expect(tracking("EN012345678EG")).not.toBe(tracking("EB012345678EG"));
    for (const raw of [
      "ENO1234567EG",
      "ENO123456789EG",
      "XENO12345678EG",
      "ENO12345678EG1",
    ])
      expect(trackings(raw)).toEqual([]);
    expect(trackings("ENO12345678EG EN012345678EG")).toEqual(["EN012345678EG"]);
  });
  it("keeps multiline deposit deliveries separate from order creation", () => {
    const r = postal(
      "عميلنا العزيز تم إنشاء الطلب الخاص بك رقم ENO12345678EG\nعميلنا العزيز\nتم تسليم شحنتك رقم ENO12345679EG\nوتم إيداع مبلغ 255 جنيه في حسابك",
    );
    expect(r.map((x) => [x.tracking, x.kind])).toEqual([
      ["EN012345678EG", "created"],
      ["EN012345679EG", "delivered"],
    ]);
  });
  it("keeps created and delivered messages separate", () => {
    const r = postal(
      "عميلنا العزيز تم تسليم الشحنة رقم EN012345678EG للمرسل إليه\nعميلنا العزيز تم إنشاء الطلب الخاص بك رقم EN012345679EG",
    );
    expect(r.map((x) => x.kind)).toEqual(["delivered", "created"]);
  });
  it("does not interpret delivery failure as delivered", () =>
    expect(
      postal("عميلنا العزيز تعذر تسليم الشحنة EN012345678EG")[0].kind,
    ).toBe("attempt"));
  it("reads quoted sheet cells", () =>
    expect(csv('name,notes\n"A,B","line1\nline2"')[1]).toEqual([
      "A,B",
      "line1\nline2",
    ]));
  it("rejects arbitrary URLs", () => {
    expect(sheetId("https://evil.test/spreadsheets/d/abc")).toBeNull();
    expect(sheetId("https://docs.google.com/spreadsheets/d/abc/edit")).toBe(
      "abc",
    );
  });
});
