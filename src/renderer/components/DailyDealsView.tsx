import { useState } from "react";
import type { FlightOffer } from "../../lib/providers/types";
import styles from "./DailyDealsView.module.css";

interface DailyDeal {
  stops: number;
  stopsLabel: string;
  deals: FlightOffer[];
}

interface Props {
  deals: DailyDeal[];
  loading?: boolean;
}

export function DailyDealsView({ deals, loading }: Props) {
  const [expandedStops, setExpandedStops] = useState<number | null>(null);

  if (loading) {
    return (
      <div className={styles.dealsContainer}>
        <div className={styles.loadingSkeleton}>
          <div className={styles.skeletonCard}></div>
          <div className={styles.skeletonCard}></div>
        </div>
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <div className={styles.dealsContainer}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>✈️</div>
          <p>No deals found</p>
          <small>Try adjusting your search criteria</small>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.dealsContainer}>
      <div className={styles.dealsHeader}>
        <h2>Best Deals</h2>
        <span className={styles.dealsCount}>{deals.reduce((sum, d) => sum + d.deals.length, 0)} offers</span>
      </div>

      <div className={styles.dealsGrid}>
        {deals.map((category) => (
          <div key={category.stops} className={styles.dealCategory}>
            <button
              className={`${styles.categoryHeader} ${expandedStops === category.stops ? styles.expanded : ""}`}
              onClick={() =>
                setExpandedStops(expandedStops === category.stops ? null : category.stops)
              }
            >
              <span className={styles.categoryTitle}>
                {category.stops === 0 ? "✈️ Nonstop" : `🛫 ${category.stopsLabel}`}
              </span>
              <span className={styles.dealCount}>{category.deals.length} deals</span>
              <span className={styles.expandIcon}>{expandedStops === category.stops ? "▼" : "▶"}</span>
            </button>

            {expandedStops === category.stops && (
              <div className={styles.dealsList}>
                {category.deals.map((deal, idx) => (
                  <div key={idx} className={styles.dealCard}>
                    <div className={styles.dealRoute}>
                      <div className={styles.airport}>{deal.origin}</div>
                      <div className={styles.arrow}>→</div>
                      <div className={styles.airport}>{deal.destination}</div>
                    </div>

                    <div className={styles.dealDates}>
                      <div className={styles.dateItem}>
                        <span className={styles.dateLabel}>Depart</span>
                        <span className={styles.dateValue}>{deal.departDate}</span>
                      </div>
                      {deal.returnDate && (
                        <div className={styles.dateItem}>
                          <span className={styles.dateLabel}>Return</span>
                          <span className={styles.dateValue}>{deal.returnDate}</span>
                        </div>
                      )}
                    </div>

                    <div className={styles.dealPrice}>
                      <span className={styles.priceValue}>{deal.price}</span>
                      <span className={styles.priceCurrency}>{deal.currency}</span>
                    </div>

                    {deal.airline && (
                      <div className={styles.dealAirline}>
                        <small>{deal.airline}</small>
                      </div>
                    )}

                    {deal.link && (
                      <a href={deal.link} target="_blank" rel="noopener noreferrer" className={styles.btnBook}>
                        View Deal →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
