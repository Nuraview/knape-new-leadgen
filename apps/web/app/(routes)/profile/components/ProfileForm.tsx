"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useTranslations } from "@/lib/i18n";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateProfile } from "@/actions/user/update-profile";

interface ProfileFormProps {
  data: any;
}

const FormSchema = z.object({
  id: z.string(),
  name: z.string().min(3).max(50),
  username: z.string().min(2).max(50),
  account_name: z.string().min(2).max(50),
  whatsApp: z.string().optional().nullable().or(z.literal("")),
});

export function ProfileForm({ data }: ProfileFormProps) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const t = useTranslations("ProfileForm");

  const router = useRouter();

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      id: data?.id || "",
      name: data?.name || "",
      username: data?.username || "",
      account_name: data?.account_name || "",
      whatsApp: data?.whatsApp || "",
    },
  });

  async function onSubmit(values: z.infer<typeof FormSchema>) {
    try {
      setIsLoading(true);
      const result = await updateProfile({
        userId: values.id,
        name: values.name,
        username: values.username,
        account_name: values.account_name,
        whatsApp: values.whatsApp || null,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Profile saved successfully");
      router.refresh();
    } catch (error) {
      toast.error("Something went wrong while saving your profile.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6 w-full p-5"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fullName")}</FormLabel>
                <FormControl>
                  <Input disabled={isLoading} placeholder="John Doe" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("username")}</FormLabel>
                <FormControl>
                  <Input disabled={isLoading} placeholder="jdoe" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="account_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("company")}</FormLabel>
                <FormControl>
                  <Input
                    disabled={isLoading}
                    placeholder="Tesla Inc.,"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="whatsApp"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("whatsApp")}</FormLabel>
                <FormControl>
                  <Input
                    disabled={isLoading}
                    placeholder="+15482518967"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormDescription className="text-xs">
                  Enter your phone number in international format (e.g. +15482518967) to receive WhatsApp notifications.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end">
          <Button className="w-[150px]" type="submit">
            {t("updateButton")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
