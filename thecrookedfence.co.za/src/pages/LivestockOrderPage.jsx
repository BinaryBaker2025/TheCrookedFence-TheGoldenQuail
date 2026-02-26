import OrderForm from "../components/OrderForm.jsx";
import { useSeo } from "../lib/seo.js";

export default function LivestockOrderPage() {
  useSeo({
    title: "Livestock Order Form | The Crooked Fence",
    description:
      "Order livestock from The Crooked Fence. Browse available types and submit your delivery request online.",
    path: "/livestock",
  });

  return <OrderForm variant="livestock" />;
}
