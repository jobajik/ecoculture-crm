import OrderForm from "@/components/OrderForm";
import { listVarietiesByType } from "@/lib/repo/varieties";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const varieties = await listVarietiesByType();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Новая заявка</h1>
      <OrderForm varieties={varieties} />
    </div>
  );
}
