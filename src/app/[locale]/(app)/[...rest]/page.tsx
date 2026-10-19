import { notFound } from "next/navigation";

// Any path no route claims gets the localized not-found page inside the app shell, rather
// than Next's bare 404 outside the locale layout.
export default function UnknownPage() {
  notFound();
}
