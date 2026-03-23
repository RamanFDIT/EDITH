import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import styles from './DonutChart.module.css';

const DonutChart = ({ segments, title, centerLabel }) => {
  if (!Array.isArray(segments) || segments.length === 0) {
    return (
      <div className={styles.container}>
        {title && <h3 className={styles.title}>{title}</h3>}
        <p className={styles.empty}>No data available</p>
      </div>
    );
  }
  const validSegments = segments.filter(s => s && typeof s.value === 'number' && s.value >= 0);
  const total = validSegments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return (
      <div className={styles.container}>
        {title && <h3 className={styles.title}>{title}</h3>}
        <p className={styles.empty}>No data available</p>
      </div>
    );
  }

  const data = validSegments.filter(s => s.value > 0).map(s => ({
    name: s.label,
    value: s.value,
    fill: s.color,
  }));

  return (
    <div className={styles.container}>
      {title && <h3 className={styles.title}>{title}</h3>}
      <div className={styles.chartWrapper}>
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '13px',
              }}
              itemStyle={{ color: '#fff' }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className={styles.centerLabel}>
          <span className={styles.centerValue}>{total}</span>
          <span className={styles.centerText}>{centerLabel || 'Total'}</span>
        </div>
      </div>
      <div className={styles.legend}>
        {data.map((entry, i) => (
          <div key={i} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ backgroundColor: entry.fill }} />
            <span className={styles.legendLabel}>{entry.name}</span>
            <span className={styles.legendValue}>{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DonutChart;
