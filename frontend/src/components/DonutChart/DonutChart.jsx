import styles from './DonutChart.module.css';

const DonutChart = ({ segments, title, centerLabel }) => {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return (
      <div className={styles.container}>
        {title && <h3 className={styles.title}>{title}</h3>}
        <p className={styles.empty}>No data available</p>
      </div>
    );
  }

  const radius = 60;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius;
  const center = radius + strokeWidth / 2;
  const size = center * 2;

  let cumulativeOffset = 0;

  return (
    <div className={styles.container}>
      {title && <h3 className={styles.title}>{title}</h3>}
      <div className={styles.chartWrapper}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={styles.svg}>
          {segments.map((segment, i) => {
            const fraction = segment.value / total;
            const dashLength = fraction * circumference;
            const dashOffset = -cumulativeOffset;
            cumulativeOffset += dashLength;

            return (
              <circle
                key={i}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dashLength} ${circumference - dashLength}`}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${center} ${center})`}
                className={styles.segment}
              />
            );
          })}
        </svg>
        <div className={styles.centerLabel}>
          <span className={styles.centerValue}>{total}</span>
          <span className={styles.centerText}>{centerLabel || 'Total'}</span>
        </div>
      </div>
      <div className={styles.legend}>
        {segments.filter(s => s.value > 0).map((segment, i) => (
          <div key={i} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ backgroundColor: segment.color }} />
            <span className={styles.legendLabel}>{segment.label}</span>
            <span className={styles.legendValue}>{segment.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DonutChart;
