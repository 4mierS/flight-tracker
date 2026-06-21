import { describe, it, expect } from "vitest";
import {
  emptyForm,
  formFromDTO,
  formToInput,
  shiftReturnWindow,
  updateStayDays,
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
  maxStayDays: "",
  returnMode: "stay-based",
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
  it("sets returnFrom to departFrom + minStay and returnTo to departTo + maxStay", () => {
    // departFrom: 2026-06-16, departTo: 2026-09-16, minStay: 7, maxStay: 0
    const next = shiftReturnWindow(filledForm, "2026-07-01");
    expect(next.departFrom).toBe("2026-07-01");
    // 2026-07-01 + 7 days = 2026-07-08
    expect(next.returnFrom).toBe("2026-07-08");
    // departTo is still 2026-09-16 + 0 days = 2026-09-16
    expect(next.returnTo).toBe("2026-09-16");
  });

  it("treats a blank min stay as zero", () => {
    const next = shiftReturnWindow({ ...filledForm, minStayDays: "" }, "2026-07-01");
    expect(next.returnFrom).toBe("2026-07-01");
  });

  it("sets returnFrom to departFrom + minStay and returnTo to departTo + maxStay", () => {
    const next = shiftReturnWindow(
      { ...filledForm, minStayDays: "7", maxStayDays: "21" },
      "2026-07-01",
    );
    expect(next.returnFrom).toBe("2026-07-08"); // 2026-07-01 + 7 days
    expect(next.returnTo).toBe("2026-10-07"); // 2026-09-16 + 21 days
  });

  it("uses zero for maxStay when not configured", () => {
    const next = shiftReturnWindow(
      { ...filledForm, minStayDays: "10", maxStayDays: "" },
      "2026-07-01",
    );
    expect(next.returnFrom).toBe("2026-07-11"); // 2026-07-01 + 10
    expect(next.returnTo).toBe("2026-09-16"); // 2026-09-16 + 0
  });

  it("leaves return fields untouched for ONE_WAY", () => {
    const oneWay = { ...filledForm, tripType: "ONE_WAY" as const };
    const next = shiftReturnWindow(oneWay, "2026-07-01");
    expect(next.departFrom).toBe("2026-07-01");
    expect(next.returnFrom).toBe(filledForm.returnFrom);
    expect(next.returnTo).toBe(filledForm.returnTo);
  });

  it("does not recalculate in date-based mode", () => {
    const dateBased = { ...filledForm, returnMode: "date-based" as const };
    const next = shiftReturnWindow(dateBased, "2026-07-01");
    expect(next.returnFrom).toBe(filledForm.returnFrom);
    expect(next.returnTo).toBe(filledForm.returnTo);
  });

  it("produces a schema-valid RETURN watch", () => {
    const next = shiftReturnWindow(filledForm, "2026-07-01");
    expect(watchInputSchema.safeParse(formToInput(next)).success).toBe(true);
  });

  it("matches user scenario: 07/20-08/30 with 13-19 days stay", () => {
    // User's case: depart 2026-07-20 to 2026-08-30, min 13, max 19
    const form: WatchFormState = {
      ...filledForm,
      departFrom: "2026-07-20",
      departTo: "2026-08-30",
      minStayDays: "13",
      maxStayDays: "19",
    };
    const next = updateStayDays(form, "13", "19");
    // returnFrom should be 2026-07-20 + 13 = 2026-08-02
    expect(next.returnFrom).toBe("2026-08-02");
    // returnTo should be 2026-08-30 + 19 = 2026-09-18
    expect(next.returnTo).toBe("2026-09-18");
  });
});

describe("updateStayDays", () => {
  it("recalculates return dates when stay days change in stay-based mode", () => {
    // departFrom: 2026-06-16, departTo: 2026-09-16
    const next = updateStayDays(filledForm, "14", "30");
    expect(next.minStayDays).toBe("14");
    expect(next.maxStayDays).toBe("30");
    // 2026-06-16 + 14 days = 2026-06-30
    expect(next.returnFrom).toBe("2026-06-30");
    // 2026-09-16 + 30 days = 2026-10-16
    expect(next.returnTo).toBe("2026-10-16");
  });

  it("does not recalculate in date-based mode", () => {
    const dateBased = { ...filledForm, returnMode: "date-based" as const };
    const next = updateStayDays(dateBased, "14", "30");
    expect(next.returnFrom).toBe(filledForm.returnFrom);
    expect(next.returnTo).toBe(filledForm.returnTo);
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
      maxStayDays: null,
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
