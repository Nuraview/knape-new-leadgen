import { Link } from "@tanstack/react-router";
import useBrand from "@/hooks/use-brand";
import useProjectStore from "@/store/project";

type LogoProps = {
  className?: string;
};

export function Logo({ className = "" }: LogoProps) {
  const { setProject } = useProjectStore();
  const brand = useBrand();

  return (
    <Link
      onClick={() => {
        setProject(undefined);
      }}
      to="/dashboard"
      className={`w-auto ${className}`}
    >
      <img src={brand.logoUrl} alt={brand.name} className="h-6 w-auto" />
    </Link>
  );
}
