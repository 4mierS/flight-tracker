import { describe, it, expect } from "vitest";
import { emptyForm, formFromDTO, formToInput, type WatchFormState } from "./form";
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
