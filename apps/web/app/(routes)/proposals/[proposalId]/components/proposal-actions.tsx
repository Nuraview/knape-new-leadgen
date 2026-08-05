"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send, Link2, Copy, FileStack, FileDown, Eye, Trash2 } from "lucide-react";
import { sendProposalEmail } from "@/actions/proposals/send-proposal-email";
import { shareProposal } from "@/actions/proposals/share-proposal";
import { duplicateProposal, saveAsTemplate } from "@/actions/proposals/duplicate";
import { deleteProposal } from "@/actions/proposals/delete-proposal";

export function ProposalActions({
  proposalId,
  defaultEmail,
  defaultSubject,
  senders = [],
}: {
  proposalId: string;
  defaultEmail?: string | null;
  defaultSubject?: string;
  senders?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Send dialog
  const [sendOpen, setSendOpen] = useState(false);
  const [to, setTo] = useState(defaultEmail ?? "");
  const [subject, setSubject] = useState(defaultSubject ?? "");
  const [message, setMessage] = useState("");
  const [senderId, setSenderId] = useState(senders[0]?.id ?? "");

  // Template dialog
  const [tplOpen, setTplOpen] = useState(false);
  const [tplName, setTplName] = useState("");

  // Delete dialog with an arithmetic challenge (anti-misclick)
  const [delOpen, setDelOpen] = useState(false);
  const [delA, setDelA] = useState(0);
  const [delB, setDelB] = useState(0);
  const [delAns, setDelAns] = useState("");

  const openDelete = () => {
    setDelA(Math.floor(Math.random() * 8) + 2); // 2–9
    setDelB(Math.floor(Math.random() * 8) + 2);
    setDelAns("");
    setDelOpen(true);
  };

  const doDelete = async () => {
    if (parseInt(delAns, 10) !== delA + delB) {
      toast.error("Wrong answer — solve the sum to confirm");
      return;
    }
    setBusy(true);
    try {
      await deleteProposal(proposalId);
      toast.success("Proposal deleted");
      router.push("/proposals");
      router.refresh();
    } catch {
      toast.error("Failed to delete");
      setBusy(false);
    }
  };

  const doSend = async () => {
    if (!to) {
      toast.error("Enter a recipient email");
      return;
    }
    setBusy(true);
    try {
      const res = await sendProposalEmail({
        proposalId,
        to,
        subject: subject || undefined,
        message: message || undefined,
        senderId: senderId || undefined,
      });
      if (res.pdfAttached) toast.success("Proposal sent with PDF attached");
      else toast.warning("Proposal sent — PDF attachment failed, link-only email");
      setSendOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setBusy(false);
    }
  };

  const doCopyLink = async () => {
    setBusy(true);
    try {
      const { url } = await shareProposal(proposalId, { markSent: true });
      await navigator.clipboard.writeText(url).catch(() => {});
      toast.success("Link copied — marked as Sent");
      router.refresh();
    } catch {
      toast.error("Failed to create link");
    } finally {
      setBusy(false);
    }
  };

  const doPreview = async () => {
    setBusy(true);
    try {
      const { url } = await shareProposal(proposalId);
      window.open(url, "_blank", "noopener");
    } catch {
      toast.error("Failed to open preview");
    } finally {
      setBusy(false);
    }
  };

  const doDuplicate = async () => {
    setBusy(true);
    try {
      const { id } = await duplicateProposal(proposalId);
      toast.success("Duplicated");
      router.push(`/proposals/${id}`);
    } catch {
      toast.error("Failed to duplicate");
    } finally {
      setBusy(false);
    }
  };

  const doSaveTemplate = async () => {
    if (!tplName) {
      toast.error("Enter a template name");
      return;
    }
    setBusy(true);
    try {
      await saveAsTemplate(proposalId, tplName);
      toast.success("Saved as template");
      setTplOpen(false);
    } catch {
      toast.error("Failed to save template");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogTrigger asChild>
          <Button size="sm">
            <Send className="mr-2 h-4 w-4" />
            Send
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Proposal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {senders.length > 0 && (
              <div className="space-y-2">
                <Label>From</Label>
                <Select value={senderId} onValueChange={setSenderId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose sender" />
                  </SelectTrigger>
                  <SelectContent>
                    {senders.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>To</Label>
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" />
            </div>
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={doSend} disabled={busy}>
              {busy ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button size="sm" variant="outline" onClick={doPreview} disabled={busy}>
        <Eye className="mr-2 h-4 w-4" />
        Preview as client
      </Button>

      <Button size="sm" variant="outline" onClick={doCopyLink} disabled={busy}>
        <Link2 className="mr-2 h-4 w-4" />
        Copy Link
      </Button>

      <Button size="sm" variant="outline" onClick={doDuplicate} disabled={busy}>
        <Copy className="mr-2 h-4 w-4" />
        Duplicate
      </Button>

      <a href={`/api/proposals/${proposalId}/pdf`} target="_blank" rel="noreferrer">
        <Button size="sm" variant="outline">
          <FileDown className="mr-2 h-4 w-4" />
          PDF
        </Button>
      </a>

      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <FileStack className="mr-2 h-4 w-4" />
            Save as Template
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Template name</Label>
            <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="e.g. Pitch Deck Proposal" />
          </div>
          <DialogFooter>
            <Button onClick={doSaveTemplate} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button
        size="sm"
        variant="outline"
        className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
        onClick={openDelete}
        disabled={busy}
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Delete
      </Button>

      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this proposal?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This removes the proposal. Solve the sum to confirm it&apos;s not a misclick.
            </p>
            <div className="flex items-center gap-3">
              <span className="text-xl font-semibold tabular-nums">
                {delA} + {delB} =
              </span>
              <Input
                className="w-24"
                inputMode="numeric"
                autoFocus
                value={delAns}
                onChange={(e) => setDelAns(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doDelete()}
                placeholder="?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={doDelete}
              disabled={busy || parseInt(delAns, 10) !== delA + delB}
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
