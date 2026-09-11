import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from "recharts";
export function AttentionChart({
  data,
}: {
  data: { date: string; views: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Line
          dataKey="views"
          name="Observed human pageviews"
          stroke="#253646"
          type="linear"
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
type Point = {
  date: string;
  revenue: number;
  orders: number;
  adSpend: number | null;
  contributionProfit: number | null;
};
export function RevenueChart({ data }: { data: Point[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line
          type="linear"
          dataKey="revenue"
          name="Revenue"
          stroke="#111827"
          connectNulls={false}
        />
        <Line
          type="linear"
          dataKey="adSpend"
          name="Ad spend"
          stroke="#b07711"
          connectNulls={false}
        />
        <Line
          type="linear"
          dataKey="contributionProfit"
          name="Contribution profit"
          stroke="#168a58"
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
export function OrdersChart({ data }: { data: Point[] }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data}>
        <XAxis dataKey="date" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="orders" fill="#253646" />
      </BarChart>
    </ResponsiveContainer>
  );
}
