import OrderForm from "../components/OrderForm.jsx";
import { useSeo } from "../lib/seo.js";

export default function EggOrderPage() {
  useSeo({
    title: "Fertile Egg Order Form | The Crooked Fence",
    description:
      "Order fertile eggs from The Crooked Fence. Choose your preferred types and delivery option online.",
    path: "/eggs",
  });

  return <OrderForm variant="eggs" />;
}
