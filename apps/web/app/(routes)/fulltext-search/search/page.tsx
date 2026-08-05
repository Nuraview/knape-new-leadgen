import { redirect } from "next/navigation";

const FullTextSearchPage = async (props: {
  searchParams?: Promise<{ q?: string }>;
}) => {
  const searchParams = await props.searchParams;
  const q = searchParams?.q;
  redirect(`/fulltext-search${q ? `?q=${encodeURIComponent(q)}` : ""}`);
};

export default FullTextSearchPage;
