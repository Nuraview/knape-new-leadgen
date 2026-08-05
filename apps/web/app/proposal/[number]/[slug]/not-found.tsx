export default function ProposalNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-semibold text-slate-800">
          Proposal unavailable
        </h1>
        <p className="mt-2 text-slate-500">
          This proposal link is invalid, has expired, or has been revoked.
          Please contact the sender for an up-to-date link.
        </p>
      </div>
    </div>
  );
}
