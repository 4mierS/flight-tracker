import { describe, it, expect } from "vitest";
import {
  emptyForm,
  formFromDTO,
  formToInput,
  shiftReturnWindow,
  type WatchFormState,
} from "./form";
import { watchInputSchema } from "../../lib/validation/watch";
import type { WatchDTO } from "../../desktop/shared";

const filledForm: WatchFormState = {
  label: "  Germany→Jordan  ",
  origins: "FRA, MUC  BER",
  destinations: "AMM",
  tripType: "RETURN",
  departFrom: "2026-06-16",
  departTo: "2026-09-16",
  returnFrom: "2026-06-23",
  returnTo: "2026-09-30",
  minStayDays: "7",
  maxStops: "0",
  directOnly: true,
  passengers: "1",
  threshold: "350",
  currency: "EUR",
  active: true,
};

describe("formToInput", () => {
  it("splits airport codes on commas and whitespace", () => {
    const input = formToInput(filledForm);
    expect(input.origins).toEqual(["FRA", "MUC", "BER"]);
    expect(input.destinations).toEqual(["AMM"]);
  });

  it("trims the label and parses numbers", () => {
    const input = formToInput(filledForm);
    expect(input.label).toBe("Germany→Jordan");
    expect(input.minStayDays).toBe(7);
    expect(input.threshold).toBe(350);
    expect(input.maxStops).toBe(0);
  });

  it("nulls return fields for ONE_WAY", () => {
    const input = formToInput({ ...filledForm, tripType: "ONE_WAY" });
    expect(input.returnFrom).toBeNull();
    expect(input.returnTo).toBeNull();
  });

  it("treats a blank threshold as null", () => {
    const input = formToInput({ ...filledForm, threshold: "" });
    expect(input.threshold).toBeNull();
  });

  it("produces output that passes the shared schema", () => {
    const input = formToInput(filledForm);
    expect(watchInputSchema.safeParse(input).success).toBe(true);
  });
});

describe("emptyForm", () => {
  it("is a valid RETURN watch out of the box", () => {
    const input = formToInput(
      // origins/destinations are required, so fill the two empty fields
      { ...emptyForm(), origins: "FRA", destinations: "AMM" },
    );
    expect(watchInputSchema.safeParse(input).success).toBe(true);
  });
});

describe("shiftReturnWindow", () => {
  it("sets returnFrom to departFrom + minStay and preserves window width", () => {
    // Original return window is 99 days wide (06-23 .. 09-30).
    const next = shiftReturnWindow(filledForm, "2026-07-01");
    expect(next.departFrom).toBe("2026-07-01");
    // 2026-07-01 + 7 days
    expect(next.returnFrom).toBe("2026-07-08");
    // width preserved: 2026-09-30 - 2026-06-23 = 99 days => 07-08 + 99
    expect(next.returnTo).toBe("2026-10-15");
  });

  it("treats a blank min stay as zero", () => {
    const next = shiftReturnWindow({ ...filledForm, minStayDays: "" }, "2026-07-01");
    expect(next.returnFrom).toBe("2026-07-01");
  });

  it("collapses the window to a single day when return dates are blank", () => {
    const next = shiftReturnWindow(
      { ...filledForm, returnFrom: "", returnTo: "" },
      "2026-07-01",
    );
    expect(next.returnFrom).toBe("2026-07-08");
    expect(next.returnTo).toBe("2026-07-08");
  });

  it("leaves return fields untouched for ONE_WAY", () => {
    const oneWay = { ...filledForm, tripType: "ONE_WAY" as const };
    const next = shiftReturnWindow(oneWay, "2026-07-01");
    expect(next.departFrom).toBe("2026-07-01");
    expect(next.returnFrom).toBe(filledForm.returnFrom);
    expect(next.returnTo).toBe(filledForm.returnTo);
  });

  it("produces a schema-valid RETURN watch", () => {
    const next = shiftReturnWindow(filledForm, "2026-07-01");
    expect(watchInputSchema.safeParse(formToInput(next)).success).toBe(true);
  });
});

describe("formFromDTO", () => {
  it("round-trips a DTO into editable form state", () => {
    const dto: WatchDTO = {
      id: "x",
      label: "Test",
      origins: ["FRA", "MUC"],
      destinations: ["AMM"],
      tripType: "RETURN",
      departFrom: "2026-06-16",
      departTo: "2026-09-16",
      returnFrom: "2026-06-23",
      returnTo: "2026-09-30",
      minStayDays: 7,
      maxStops: 0,
      directOnly: true,
      passengers: 1,
      threshold: 350,
      currency: "EUR",
      snoozeUntil: null,
      active: true,
      createdAt: "2026-06-16T00:00:00.000Z",
      updatedAt: "2026-06-16T00:00:00.000Z",
      bestPrice: 656,
    };
    const form = formFromDTO(dto);
    expect(form.origins).toBe("FRA, MUC");
    expect(form.minStayDays).toBe("7");
    expect(formToInput(form).origins).toEqual(["FRA", "MUC"]);
  });
});
