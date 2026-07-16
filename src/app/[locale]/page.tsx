import { redirect } from "next/navigation";

export default async function LocaleRoot(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  redirect(`/${params.locale}/dashboard`);
}
