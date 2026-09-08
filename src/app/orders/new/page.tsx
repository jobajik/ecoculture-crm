import OrderForm from "@/components/OrderForm";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { getCurrentPrices } from "@/lib/repo/prices";
import { priceMapForClient } from "@/lib/priceList";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const [varieties, prices] = await Promise.all([listVarietiesByType(), getCurrentPrices()]);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Новая заявка</h1>
      <OrderForm varieties={varieties} prices={priceMapForClient(prices)} />
    </div>
  );
}
