import {
  CheckCircledIcon,
  CircleIcon,
  CrossCircledIcon,
  CursorArrowIcon,
  EnvelopeClosedIcon,
  EnvelopeOpenIcon,
  PaperPlaneIcon,
  QuestionMarkCircledIcon,
  StopwatchIcon,
} from "@radix-ui/react-icons";

export const statuses = [
  {
    value: "NEW",
    label: "New",
    icon: QuestionMarkCircledIcon,
  },
  {
    value: "IN_PROGRESS",
    label: "In progress",
    icon: StopwatchIcon,
  },
  {
    value: "COMPLETED",
    label: "Completed",
    icon: StopwatchIcon,
  },
];

export const engagementStatuses = [
  { value: "clicked", label: "Clicked", icon: CursorArrowIcon },
  { value: "opened", label: "Opened", icon: EnvelopeOpenIcon },
  { value: "bounced", label: "Bounced", icon: CrossCircledIcon },
  { value: "delivered", label: "Delivered", icon: CheckCircledIcon },
  { value: "sent", label: "Sent", icon: PaperPlaneIcon },
  { value: "queued", label: "Queued", icon: EnvelopeClosedIcon },
  { value: "none", label: "Not contacted", icon: CircleIcon },
];
