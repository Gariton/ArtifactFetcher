'use client';

import { LockEntry } from "@/lib/progressBus";
import { Button, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { IconAlertCircle, IconDownload } from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";
import { ProgressEvent } from "@/lib/progressBus";
import { ProgressBanner, ProgressModal, type ProgressItem } from "@/components/ProgressModal";
import { CarbonForm, CarbonSection, CarbonTextarea, CarbonFooter, CarbonSubmit, CarbonGhostButton, carbonClasses } from "@/components/CarbonForm";

export function DownloadPane () {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<null|string>(null);
    const [jobId, setJobId] = useState<string|null>(null);
    const [status, setStatus] = useState<string>("idle");
    const [opened, {open, close}] = useDisclosure(false);
    const [packages, setPackages] = useState<LockEntry[]>([]);
    const [perPackage, setPerPackage] = useState<Record<number, { received: number; total?: number }>>({});
    const esRef = useRef<EventSource | null>(null);
    const form = useForm({
        mode: "controlled",
        initialValues: {
            packages: ""
        },
        validate: {
            packages: (v) => v=="" ? "パッケージ名を入力してください" : null
        }
    });

    const reset = useCallback(() => {
        setJobId(null);
        setStatus("idle");
        setPackages([]);
        setPerPackage({});
        esRef.current?.close();
        esRef.current = null;
    }, [])

    const onSubmit = async (values: typeof form.values) => {
        setLoading(true);
        setError(null);
        reset();
        setStatus("starting");
        open();
        try {
            const specs = values.packages.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
            const res = await fetch('/api/npm/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    specs,
                    bundleName: 'npm-from-specs'
                }),
            });
            if (!res.ok) { alert("Failed to start"); return; }
            const { jobId } = await res.json();
            setJobId(jobId);
            setStatus("running");

            const es = new EventSource(`/api/build/progress?jobId=${jobId}`);
            esRef.current = es;
            es.onopen = () => {
                console.debug("SSE open");
            }
            es.onerror = (e) => {
                console.error("SSE error", e);
            }
            es.onmessage = (ev) => {
                const data = JSON.parse(ev.data) as ProgressEvent;
                if (data.type === 'manifest-resolved') setPackages(data.items as LockEntry[]);
                if (data.type === 'item-progress') setPerPackage((prev) => ({ ...prev, [data.index]: { received: data.received, total: data.total } }));
                if (data.type === 'stage') setStatus(data.stage);
                if (data.type === 'error') { setStatus('error'); es.close(); }
                if (data.type === 'done') {
                    setStatus('done');
                    es.close();
                }
            }
        } catch (e: any) {
            setError(e.message || "ダウンロードに失敗しました")
        } finally {
            setLoading(false);
        }
    }

    const handleModalClose = useCallback(() => {
        const currentJobId = jobId;
        close();
        reset();
        if (!currentJobId) return;
        (async () => {
            try {
                await fetch(`/api/build/delete?jobId=${currentJobId}`, { method: "POST" });
            } catch (err) {
                console.error("ファイル削除失敗", err);
            }
        })();
    }, [jobId, close, reset]);

    const totals = Object.values(perPackage).reduce<{ received: number; total: number }>(
        (acc, v) => { acc.received += v.received || 0; acc.total += v.total || 0; return acc; },
        { received: 0, total: 0 }
    );
    const overallPercent = totals.total > 0 ? Math.floor((totals.received / totals.total) * 100) : (status === "done" ? 100 : 0);
    const indeterminate = status === "starting" || status === "running" || packages.length === 0;
    const state: "running" | "done" | "error" = status === "done" ? "done" : status === "error" ? "error" : "running";

    const items: ProgressItem[] = packages.map((pkg, i) => {
        const info = perPackage[i];
        const pct = info?.total ? Math.floor(((info.received || 0) / info.total) * 100) : 0;
        const done = pct >= 100;
        return {
            key: `${i}`,
            label: pkg.name,
            status: done ? "done" : (info?.received ?? 0) > 0 ? "running" : "waiting",
            percent: pct,
            meta: done ? "完了" : info?.total ? `${(info.total / 1_000_000).toFixed(1)}MB` : "待機",
        };
    });
    const doneCount = items.filter((i) => i.status === "done").length;

    return (
        <div>
            <CarbonForm accent="npm" onSubmit={form.onSubmit(onSubmit)}>
                <CarbonSection label="取得対象">
                    <CarbonTextarea
                        label={<>パッケージ名 <span className={carbonClasses.required}>必須</span></>}
                        value={form.getValues().packages}
                        onChange={(v) => form.setFieldValue("packages", v)}
                        placeholder="react@^18 axios"
                        rows={5}
                        disabled={loading}
                        desc="ダウンロードしたいパッケージ名をスペースまたは改行で区切って入力"
                        error={form.errors.packages as string | undefined}
                    />
                </CarbonSection>
                <CarbonFooter hint="依存を全解決して tar 化します">
                    {jobId && <CarbonGhostButton onClick={open}>進捗を表示</CarbonGhostButton>}
                    <CarbonSubmit loading={loading}>取得を開始</CarbonSubmit>
                </CarbonFooter>
            </CarbonForm>

            {error && (
                <div className={carbonClasses.errorText} style={{ marginTop: 16 }}>
                    <IconAlertCircle size={14} stroke={2} />{error}
                </div>
            )}

            <ProgressModal
                opened={opened}
                onClose={handleModalClose}
                accent="npm"
                title={state === "done" ? "取得完了" : state === "error" ? "取得に失敗" : "取得中"}
                subtitle={`${packages.length} packages`}
                overallPercent={indeterminate ? undefined : overallPercent}
                state={state}
                stats={[
                    { value: doneCount, unit: `/${packages.length}`, label: "完了 / 全体", accent: state === "done" },
                    { value: (totals.received / 1_000_000).toFixed(0), unit: " MB", label: "取得サイズ" },
                    { value: packages.length, label: "パッケージ" },
                ]}
                items={items}
                banner={state === "done" ? (
                    <ProgressBanner tone="success" title={`${packages.length} パッケージを取得しました`} detail={`${(totals.received / 1_000_000).toFixed(1)} MB`} />
                ) : undefined}
                footer={state === "done" ? (
                    <>
                        <Button variant="default" radius="md" onClick={handleModalClose}>閉じる</Button>
                        <Button
                            color="success"
                            radius="md"
                            leftSection={<IconDownload size="1rem" />}
                            component="a"
                            href={`/api/build/download?jobId=${jobId}`}
                            target="_blank"
                            disabled={jobId == null}
                        >
                            アーカイブをダウンロード
                        </Button>
                    </>
                ) : (
                    <>
                        <Text className="af-mono" fz={12.5} c="var(--af-muted)">
                            {indeterminate ? "依存を解決しています…" : `${doneCount} / ${packages.length}`}
                        </Text>
                        <Button variant="default" radius="md" onClick={handleModalClose}>キャンセル</Button>
                    </>
                )}
            />
        </div>
    );
}
