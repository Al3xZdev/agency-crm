export function StatCard({
  value,
  label,
  loading,
}: {
  value: number | string;
  label: string;
  loading?: boolean;
}) {
  return (
    <div className="stat-card">
      <div className="n">{loading ? '—' : value}</div>
      <div className="l">{label}</div>
    </div>
  );
}