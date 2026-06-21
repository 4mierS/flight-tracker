import { describe, it, expect } from "vitest";
import {
  deriveReturnWindow,
  enumerateTrips,
  countTrips,
} from "./enumerate-trips";
import type { Watch } from "@prisma/client";

describe("enumerate-trips", () => {
  describe("deriveReturnWindow", () => {
    it("returns null for ONE_WAY trips", () => {
      const watch: Watch = {
        id: "test",
        label: "test",
        origins: ["FRA"],
        destinations: ["AMM"],
        tripType: "ONE_WAY",
        departFrom: new Date("2026-07-20"),
        departTo: new Date("2026-09-30"),
        returnFrom: null,
        returnTo: null,
        minStayDays: null,
        maxStayDays: null,
        maxStops: 2,
        directOnly: false,
        passengers: 1,
        threshold: null,
        currency: "EUR",
        snoozeUntil: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = deriveReturnWindow(watch);
      expect(result).toBeNull();
    });

    it("derives return window from min/max stay days", () => {
      const watch: Watch = {
        id: "test",
        label: "test",
        origins: ["FRA"],
        destinations: ["AMM"],
        tripType: "RETURN",
        departFrom: new Date("2026-07-20"),
        departTo: new Date("2026-09-30"),
        returnFrom: null,
        returnTo: null,
        minStayDays: 14,
        maxStayDays: 18,
        maxStops: 2,
        directOnly: false,
        passengers: 1,
        threshold: null,
        currency: "EUR",
        snoozeUntil: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = deriveReturnWindow(watch);
      expect(result).toEqual({
        returnFrom: "2026-08-03", // 2026-07-20 + 14 days
        returnTo: "2026-10-18", // 2026-09-30 + 18 days
      });
    });
  });

  describe("enumerateTrips", () => {
    it("handles ONE_WAY trips", () => {
      const watch: Watch = {
        id: "test",
        label: "test",
        origins: ["FRA"],
        destinations: ["AMM"],
        tripType: "ONE_WAY",
        departFrom: new Date("2026-07-20"),
        departTo: new Date("2026-07-22"),
        returnFrom: null,
        returnTo: null,
        minStayDays: null,
        maxStayDays: null,
        maxStops: 2,
        directOnly: false,
        passengers: 1,
        threshold: null,
        currency: "EUR",
        snoozeUntil: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const trips = enumerateTrips(watch);

      // 1 origin × 1 destination × 3 days = 3 trips
      expect(trips).toHaveLength(3);
      expect(trips[0]).toEqual({
        origin: "FRA",
        destination: "AMM",
        departDate: "2026-07-20",
        returnDate: null,
      });
      expect(trips[2]).toEqual({
        origin: "FRA",
        destination: "AMM",
        departDate: "2026-07-22",
        returnDate: null,
      });
    });

    it("handles RETURN trips with stay range", () => {
      const watch: Watch = {
        id: "test",
        label: "test",
        origins: ["FRA"],
        destinations: ["AMM"],
        tripType: "RETURN",
        departFrom: new Date("2026-07-20"),
        departTo: new Date("2026-07-21"),
        returnFrom: null,
        returnTo: null,
        minStayDays: 14,
        maxStayDays: 15,
        maxStops: 2,
        directOnly: false,
        passengers: 1,
        threshold: null,
        currency: "EUR",
        snoozeUntil: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const trips = enumerateTrips(watch);

      // 1 origin × 1 destination × 2 depart days × 2 stay durations = 4 trips
      expect(trips).toHaveLength(4);

      // First day, 14-day stay
      expect(trips[0]).toEqual({
        origin: "FRA",
        destination: "AMM",
        departDate: "2026-07-20",
        returnDate: "2026-08-03",
      });

      // First day, 15-day stay
      expect(trips[1]).toEqual({
        origin: "FRA",
        destination: "AMM",
        departDate: "2026-07-20",
        returnDate: "2026-08-04",
      });

      // Second day, 14-day stay
      expect(trips[2]).toEqual({
        origin: "FRA",
        destination: "AMM",
        departDate: "2026-07-21",
        returnDate: "2026-08-04",
      });

      // Second day, 15-day stay
      expect(trips[3]).toEqual({
        origin: "FRA",
        destination: "AMM",
        departDate: "2026-07-21",
        returnDate: "2026-08-05",
      });
    });

    it("enumerates cartesian product of origins and destinations", () => {
      const watch: Watch = {
        id: "test",
        label: "test",
        origins: ["FRA", "MUC"],
        destinations: ["AMM", "CAI"],
        tripType: "ONE_WAY",
        departFrom: new Date("2026-07-20"),
        departTo: new Date("2026-07-20"),
        returnFrom: null,
        returnTo: null,
        minStayDays: null,
        maxStayDays: null,
        maxStops: 2,
        directOnly: false,
        passengers: 1,
        threshold: null,
        currency: "EUR",
        snoozeUntil: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const trips = enumerateTrips(watch);

      // 2 origins × 2 destinations × 1 day = 4 trips
      expect(trips).toHaveLength(4);
      expect(trips.map((t) => [t.origin, t.destination])).toEqual([
        ["FRA", "AMM"],
        ["FRA", "CAI"],
        ["MUC", "AMM"],
        ["MUC", "CAI"],
      ]);
    });

    it("pin test: matches spec requirement (365 combos/origin, 1460 total)", () => {
      // departFrom 2026-07-20, departTo 2026-09-30, minStay 14, maxStay 18, 4 origins
      const watch: Watch = {
        id: "test",
        label: "test",
        origins: ["FRA", "MUC", "BER", "DUS"],
        destinations: ["AMM"],
        tripType: "RETURN",
        departFrom: new Date("2026-07-20"),
        departTo: new Date("2026-09-30"),
        returnFrom: null,
        returnTo: null,
        minStayDays: 14,
        maxStayDays: 18,
        maxStops: 2,
        directOnly: false,
        passengers: 1,
        threshold: null,
        currency: "EUR",
        snoozeUntil: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const count = countTrips(watch);
      // 4 origins × 1 destination × 73 depart days × 5 stay durations = 1460
      expect(count).toBe(1460);

      const trips = enumerateTrips(watch);
      expect(trips).toHaveLength(1460);

      // Verify first day has 14-day stay (the critical case from spec)
      const firstDayTrips = trips.filter((t) => t.departDate === "2026-07-20");
      const has14DayStay = firstDayTrips.some(
        (t) => t.returnDate === "2026-08-03",
      );
      expect(has14DayStay).toBe(true);
    });
  });

  describe("countTrips", () => {
    it("counts ONE_WAY trips correctly", () => {
      const watch: Watch = {
        id: "test",
        label: "test",
        origins: ["FRA", "MUC"],
        destinations: ["AMM", "CAI"],
        tripType: "ONE_WAY",
        departFrom: new Date("2026-07-20"),
        departTo: new Date("2026-07-25"),
        returnFrom: null,
        returnTo: null,
        minStayDays: null,
        maxStayDays: null,
        maxStops: 2,
        directOnly: false,
        passengers: 1,
        threshold: null,
        currency: "EUR",
        snoozeUntil: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 2 origins × 2 destinations × 6 days = 24
      expect(countTrips(watch)).toBe(24);
    });

    it("counts RETURN trips correctly", () => {
      const watch: Watch = {
        id: "test",
        label: "test",
        origins: ["FRA"],
        destinations: ["AMM"],
        tripType: "RETURN",
        departFrom: new Date("2026-07-20"),
        departTo: new Date("2026-07-22"),
        returnFrom: null,
        returnTo: null,
        minStayDays: 14,
        maxStayDays: 15,
        maxStops: 2,
        directOnly: false,
        passengers: 1,
        threshold: null,
        currency: "EUR",
        snoozeUntil: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 1 origin × 1 destination × 3 days × 2 stay durations = 6
      expect(countTrips(watch)).toBe(6);
    });
  });
});
