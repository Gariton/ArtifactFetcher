'use client';
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { useRef, useState, useEffect, useCallback } from "react";
import {
    IconAlertCircle,
    IconArrowRight,
    IconChevronDown,
    IconCube,
    IconEye,
    IconEyeOff,
    IconKey,
    IconLock,
    IconWorld,
} from "@tabler/icons-react";
import { Layer } from "@/lib/progressBus";
import { ProgressEvent } from "@/lib/progressBus";
import { DownloadModal } from "@/components/Download/Modal";
import classes from "./download.module.css";

const PLATFORMS = ["linux/amd64", "linux/arm64"];

type FormType = {
    registry: string;
    repo: string;
    tag: string;
    platform: string;
    username: string;
    password: string;
    insecureTLS: boolean;
}

export function DownloadPane() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<null|string>(null);
    const [opened, {open, close}] = useDisclosure(false);
    const [authOpen, setAuthOpen] = useState(true);
    const [showPassword, setShowPassword] = useState(false);

    const [jobId, setJobId] = useState<string|null>(null);
    const [status, setStatus] = useState<string>("idle");
    const [layers, setLayers] = useState<Layer[]>([]);
    // Mutable store (no re-render on every chunk)
    const perLayerRef = useRef<Record<number, { received: number; total?: number; status: "process"|"done"|"skipped" }>>({});
    // Throttled snapshot for UI
    const [perLayerSnap, setPerLayerSnap] = useState<Record<number, { received: number; total?: number; status: "process"|"done"|"skipped" }>>({});
    // Throttle config (ms)
    const FLUSH_INTERVAL = 250;
    const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
    const scheduleFlush = useCallback(() => {
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            // create a shallow copy so React sees a new reference
            setPerLayerSnap({ ...perLayerRef.current });
        }, FLUSH_INTERVAL);
    }, []);
    const esRef = useRef<EventSource | null>(null);
    
    const reset = useCallback(() => {
        setJobId(null);
        setStatus("idle");
        setLayers([]);
        perLayerRef.current = {};
        setPerLayerSnap({});
        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
        esRef.current?.close();
        esRef.current = null;
    }, [])
    
    const form = useForm<FormType>({
        mode: "controlled",
        initialValues: {
            registry: "",
            repo: "",
            tag: "",
            platform: "linux/amd64",
            username: "",
            password: "",
            insecureTLS: false
        },
        validate: {
            repo: (v) => v=="" ? "リポジトリを指定してください" : null,
            tag: (v) => v=="" ? "タグを指定してください" : null,
            platform: (v) => v=="" ? "プラットフォームを指定してください" : null
        }
    })
    
    const onSubmit = useCallback(async (values: typeof form.values) => {
        setLoading(true);
        setError(null);
        reset();
        setStatus("starting");
        open();
        try {
            const res = await fetch('/api/docker/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(values),
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
                if (data.type === 'manifest-resolved') setLayers(data.items as Layer[]);
                if (data.type === 'item-progress') {
                    const prev = perLayerRef.current[data.index] || { received: 0, total: data.total, status: "process" as const };
                    perLayerRef.current[data.index] = { received: data.received, total: data.total ?? prev.total, status: "process" };
                    scheduleFlush();
                }
                if (data.type === 'item-done') {
                    const prev = perLayerRef.current[data.index] || { received: 0, total: undefined, status: "process" as const };
                    perLayerRef.current[data.index] = { ...prev, status: "done" };
                    scheduleFlush();
                }
                if (data.type === 'stage') setStatus(data.stage);
                if (data.type === 'error') {
                    setStatus('error'); es.close();
                }
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
    }, [open, reset, scheduleFlush, form]);

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

    useEffect(() => {
        return () => {
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            esRef.current?.close();
        };
    }, []);
    
    const values = form.getValues();
    const registryLabel = values.registry?.trim() || "registry-1.docker.io";
    const authConfigured = Boolean(values.username && values.password);
    const authSub = `${registryLabel} · ${values.username ? "認証あり" : "認証なし"} · TLS 検証 ${values.insecureTLS ? "OFF" : "ON"}`;
    const repoError = form.errors.repo as string | undefined;

    return (
        <div>
            <form onSubmit={form.onSubmit(onSubmit)}>
                <div className={classes.card}>

                    {/* ---- 接続 / 認証設定 ---- */}
                    <div>
                        <button
                            type="button"
                            className={classes.authHeader}
                            onClick={() => setAuthOpen((o) => !o)}
                            aria-expanded={authOpen}
                        >
                            <span className={classes.fieldIcon}><IconLock size={18} stroke={1.7} /></span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className={classes.authHeaderTitle}>接続 / 認証設定</div>
                                <div className={classes.authSub}>{authSub}</div>
                            </div>
                            <span className={`${classes.chip} ${authConfigured ? classes.chipOk : classes.chipMuted}`}>
                                {authConfigured ? "設定済" : "任意"}
                            </span>
                            <span className={`${classes.chevron} ${authOpen ? classes.chevronOpen : ""}`}>
                                <IconChevronDown size={18} stroke={1.7} />
                            </span>
                        </button>

                        {authOpen && (
                            <div className={classes.authBody}>
                                <div>
                                    <label className={classes.label}>レジストリ URL</label>
                                    <div className={classes.fieldBox}>
                                        <span className={classes.fieldIcon}><IconWorld size={16} stroke={1.6} /></span>
                                        <input
                                            className={classes.input}
                                            placeholder="registry-1.docker.io"
                                            value={values.registry}
                                            onChange={(e) => form.setFieldValue("registry", e.currentTarget.value)}
                                            disabled={loading}
                                        />
                                    </div>
                                </div>
                                <div className={classes.grid2}>
                                    <div>
                                        <label className={classes.label}>ユーザー名</label>
                                        <div className={classes.fieldBox}>
                                            <input
                                                className={classes.input}
                                                placeholder="username"
                                                value={values.username}
                                                onChange={(e) => form.setFieldValue("username", e.currentTarget.value)}
                                                disabled={loading}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className={classes.label}>パスワード / トークン</label>
                                        <div className={classes.fieldBox}>
                                            <span className={classes.fieldIcon}><IconKey size={16} stroke={1.6} /></span>
                                            <input
                                                className={classes.input}
                                                type={showPassword ? "text" : "password"}
                                                placeholder="password / token"
                                                value={values.password}
                                                onChange={(e) => form.setFieldValue("password", e.currentTarget.value)}
                                                disabled={loading}
                                            />
                                            <button
                                                type="button"
                                                className={classes.iconBtn}
                                                onClick={() => setShowPassword((s) => !s)}
                                                aria-label={showPassword ? "隠す" : "表示"}
                                            >
                                                {showPassword ? <IconEyeOff size={16} stroke={1.6} /> : <IconEye size={16} stroke={1.6} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div
                                    className={classes.toggleRow}
                                    role="switch"
                                    aria-checked={values.insecureTLS}
                                    tabIndex={0}
                                    onClick={() => form.setFieldValue("insecureTLS", !values.insecureTLS)}
                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); form.setFieldValue("insecureTLS", !values.insecureTLS); } }}
                                >
                                    <span className={`${classes.toggle} ${values.insecureTLS ? classes.toggleOn : ""}`}>
                                        <span className={`${classes.knob} ${values.insecureTLS ? classes.knobOn : ""}`} />
                                    </span>
                                    <span className={classes.toggleLabel}>TLS 証明書の検証をスキップ</span>
                                    <span className={classes.warnBadge}>注意</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ---- 取得対象 ---- */}
                    <div className={classes.mainBody}>
                        <div className={classes.eyebrow}>取得対象</div>
                        <div>
                            <label className={`${classes.label} ${classes.labelLg}`}>
                                リポジトリ <span className={classes.required}>必須</span>
                            </label>
                            <div className={`${classes.fieldBox} ${classes.repoBox} ${repoError ? classes.errorBox : ""}`}>
                                <span className={classes.fieldIcon}><IconCube size={18} stroke={1.7} /></span>
                                <input
                                    className={`${classes.input} ${classes.inputLg}`}
                                    placeholder="library/nginx"
                                    value={values.repo}
                                    onChange={(e) => form.setFieldValue("repo", e.currentTarget.value)}
                                    disabled={loading}
                                />
                            </div>
                            {repoError && (
                                <div className={classes.errorText}>
                                    <IconAlertCircle size={13} stroke={2} />{repoError}
                                </div>
                            )}
                        </div>
                        <div className={classes.grid2}>
                            <div>
                                <label className={`${classes.label} ${classes.labelLg}`}>タグ</label>
                                <div className={classes.fieldBox}>
                                    <input
                                        className={`${classes.input} ${classes.inputLg}`}
                                        placeholder="1.27-alpine"
                                        value={values.tag}
                                        onChange={(e) => form.setFieldValue("tag", e.currentTarget.value)}
                                        disabled={loading}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className={`${classes.label} ${classes.labelLg}`}>プラットフォーム</label>
                                <div className={classes.segmented}>
                                    {PLATFORMS.map((p) => (
                                        <button
                                            key={p}
                                            type="button"
                                            className={`${classes.segItem} ${values.platform === p ? classes.segItemActive : ""}`}
                                            onClick={() => form.setFieldValue("platform", p)}
                                            disabled={loading}
                                        >
                                            {p}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ---- action footer ---- */}
                    <div className={classes.footer}>
                        <span className={classes.hint}>依存を解決して tar 化します</span>
                        <div className={classes.actions}>
                            {jobId && (
                                <button type="button" className={classes.btnGhost} onClick={open}>進捗を表示</button>
                            )}
                            <button type="submit" className={classes.btnPrimary} disabled={loading}>
                                取得を開始
                                <IconArrowRight size={17} stroke={2} />
                            </button>
                        </div>
                    </div>

                </div>
            </form>

            {error && (
                <div className={classes.errorText} style={{ marginTop: 16 }}>
                    <IconAlertCircle size={14} stroke={2} />{error}
                </div>
            )}

            <DownloadModal
                opened={opened}
                onClose={() => handleModalClose()}
                repo={form.getValues().repo}
                tag={form.getValues().tag}
                status={status}
                jobId={jobId}
                layers={layers}
                perLayer={perLayerSnap}
            />
        </div>
    );
}
