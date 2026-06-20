"use client";

import { useQuery } from "@tanstack/react-query";
import { Bot, Sparkles, ZapOff } from "lucide-react";
import { getJSON, type ProfileResponse } from "@/lib/api";
import { Card, PageHeader, Badge, Skeleton } from "@/components/ui/primitives";
import { ResumeUpload } from "@/components/details/ResumeUpload";
import { PortalManager } from "@/components/details/PortalManager";
import { ProfileEditor } from "@/components/details/ProfileEditor";
import { AutoApplyCard } from "@/components/details/AutoApplyCard";

export default function DetailsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => getJSON<ProfileResponse>("/api/resume"),
  });
  const { data: status } = useQuery({
    queryKey: ["llm-status"],
    queryFn: () => getJSON<{ llmEnabled: boolean }>("/api/profile"),
  });

  const profile = data?.profile ?? null;
  const files = data?.files ?? profile?.files ?? [];
  const llmEnabled = status?.llmEnabled;

  return (
    <div>
      <PageHeader
        title="My Details"
        subtitle="Your resume is the agent's single source of truth."
        action={
          llmEnabled === undefined ? null : llmEnabled ? (
            <Badge tone="brand"><Sparkles size={12} /> AI parsing on</Badge>
          ) : (
            <Badge tone="neutral"><ZapOff size={12} /> Heuristic mode</Badge>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-1 text-sm font-semibold">Resume</div>
            <p className="mb-4 text-xs text-ink-faint">Upload a PDF — the agent extracts a structured profile you can review and correct.</p>
            <ResumeUpload files={files} />
          </Card>

          <PortalManager />

          <AutoApplyCard />
        </div>

        <div className="space-y-6">
          {isLoading ? (
            <Skeleton className="h-56" />
          ) : profile ? (
            <ProfileEditor profile={profile} />
          ) : (
            <Card className="flex h-56 flex-col items-center justify-center p-5 text-center">
              <Bot className="mb-2 text-ink-faint" />
              <div className="text-sm font-medium">No profile yet</div>
              <div className="text-xs text-ink-faint">Upload a resume to get started.</div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
