'use client';

import { CSSProperties, ReactNode, useState } from "react";
import {
    IconAlertCircle,
    IconArrowRight,
    IconChevronDown,
    IconCheck,
    IconEye,
    IconEyeOff,
    type TablerIcon,
} from "@tabler/icons-react";
import { type ManagerId } from "../managers";
import classes from "./styles.module.css";

function accentStyle(accent: ManagerId): CSSProperties {
    return { ["--accent" as string]: `var(--af-${accent})` };
}

/** form + bordered card with accent context */
export function CarbonForm({
    accent,
    onSubmit,
    children,
}: {
    accent: ManagerId;
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    children: ReactNode;
}) {
    return (
        <form onSubmit={onSubmit}>
            <div className={classes.card} style={accentStyle(accent)}>
                {children}
            </div>
        </form>
    );
}

/** Expandable 接続/設定 panel */
export function CarbonAuthPanel({
    icon: Icon,
    title,
    sub,
    configured,
    defaultOpen = true,
    children,
}: {
    icon: TablerIcon;
    title: string;
    sub: string;
    configured?: boolean;
    defaultOpen?: boolean;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div>
            <button type="button" className={classes.authHeader} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                <span className={classes.fieldIcon}><Icon size={18} stroke={1.7} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div className={classes.authHeaderTitle}>{title}</div>
                    <div className={classes.authSub}>{sub}</div>
                </div>
                <span className={`${classes.chip} ${configured ? classes.chipOk : classes.chipMuted}`}>
                    {configured ? "設定済" : "任意"}
                </span>
                <span className={`${classes.chevron} ${open ? classes.chevronOpen : ""}`}>
                    <IconChevronDown size={18} stroke={1.7} />
                </span>
            </button>
            {open && <div className={classes.authBody}>{children}</div>}
        </div>
    );
}

export function CarbonSection({ label, children }: { label?: string; children: ReactNode }) {
    return (
        <div className={classes.section}>
            {label && <div className={classes.eyebrow}>{label}</div>}
            {children}
        </div>
    );
}

function FieldLabel({ label, required, optional, small }: { label?: ReactNode; required?: boolean; optional?: boolean; small?: boolean }) {
    if (!label) return null;
    return (
        <label className={`${classes.label} ${small ? classes.labelSm : ""}`}>
            {label}
            {required && <span className={classes.required}>必須</span>}
            {optional && <span className={classes.optional}>任意</span>}
        </label>
    );
}

/** single-line text field */
export function CarbonField({
    label,
    required,
    optional,
    small,
    accent,
    error,
    icon: Icon,
    rightSection,
    type = "text",
    value,
    onChange,
    placeholder,
    disabled,
    desc,
}: {
    label?: ReactNode;
    required?: boolean;
    optional?: boolean;
    small?: boolean;
    accent?: boolean;
    error?: string;
    icon?: TablerIcon;
    rightSection?: ReactNode;
    type?: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    disabled?: boolean;
    desc?: string;
}) {
    return (
        <div>
            <FieldLabel label={label} required={required} optional={optional} small={small} />
            <div className={`${classes.fieldBox} ${accent ? classes.accentBox : ""} ${error ? classes.errorBox : ""}`}>
                {Icon && <span className={classes.fieldIcon}><Icon size={accent ? 18 : 16} stroke={1.7} /></span>}
                <input
                    className={`${classes.input} ${accent ? classes.inputLg : ""}`}
                    type={type}
                    value={value}
                    onChange={(e) => onChange(e.currentTarget.value)}
                    placeholder={placeholder}
                    disabled={disabled}
                />
                {rightSection}
            </div>
            {error ? <div className={classes.errorText}><IconAlertCircle size={13} stroke={2} />{error}</div> : desc ? <div className={classes.desc}>{desc}</div> : null}
        </div>
    );
}

/** password field with show/hide */
export function CarbonPassword({
    label, optional, value, onChange, placeholder, disabled, icon: Icon,
}: {
    label?: ReactNode; optional?: boolean; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; icon?: TablerIcon;
}) {
    const [show, setShow] = useState(false);
    return (
        <CarbonField
            label={label}
            optional={optional}
            icon={Icon}
            type={show ? "text" : "password"}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            disabled={disabled}
            rightSection={
                <button type="button" className={classes.iconBtn} onClick={() => setShow((s) => !s)} aria-label={show ? "隠す" : "表示"}>
                    {show ? <IconEyeOff size={16} stroke={1.6} /> : <IconEye size={16} stroke={1.6} />}
                </button>
            }
        />
    );
}

/** multi-line field */
export function CarbonTextarea({
    label, required, optional, small, value, onChange, placeholder, disabled, rows = 5, desc, error,
}: {
    label?: ReactNode; required?: boolean; optional?: boolean; small?: boolean; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; rows?: number; desc?: string; error?: string;
}) {
    return (
        <div>
            <FieldLabel label={label} required={required} optional={optional} small={small} />
            <textarea
                className={classes.textarea}
                value={value}
                onChange={(e) => onChange(e.currentTarget.value)}
                placeholder={placeholder}
                disabled={disabled}
                rows={rows}
                style={error ? { borderColor: "color-mix(in oklch, var(--af-error) 65%, transparent)" } : undefined}
            />
            {error ? <div className={classes.errorText}><IconAlertCircle size={13} stroke={2} />{error}</div> : desc ? <div className={classes.desc}>{desc}</div> : null}
        </div>
    );
}

export function CarbonSegmented({
    label, options, value, onChange, disabled,
}: {
    label?: ReactNode; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
    return (
        <div>
            <FieldLabel label={label} />
            <div className={classes.segmented}>
                {options.map((o) => (
                    <button key={o.value} type="button" className={`${classes.segItem} ${value === o.value ? classes.segItemActive : ""}`} onClick={() => onChange(o.value)} disabled={disabled}>
                        {o.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function CarbonToggle({
    checked, onChange, label, badge,
}: {
    checked: boolean; onChange: (v: boolean) => void; label: string; badge?: string;
}) {
    return (
        <div
            className={classes.toggleRow}
            role="switch"
            aria-checked={checked}
            tabIndex={0}
            onClick={() => onChange(!checked)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange(!checked); } }}
        >
            <span className={`${classes.toggle} ${checked ? classes.toggleOn : ""}`}>
                <span className={`${classes.knob} ${checked ? classes.knobOn : ""}`} />
            </span>
            <span className={classes.toggleLabel}>{label}</span>
            {badge && <span className={classes.warnBadge}>{badge}</span>}
        </div>
    );
}

export function CarbonCheckbox({
    checked, onChange, label, disabled,
}: {
    checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean;
}) {
    return (
        <div
            className={classes.checkRow}
            role="checkbox"
            aria-checked={checked}
            tabIndex={0}
            onClick={() => !disabled && onChange(!checked)}
            onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onChange(!checked); } }}
            style={disabled ? { opacity: 0.5, cursor: "default" } : undefined}
        >
            <span className={`${classes.checkbox} ${checked ? classes.checkboxOn : ""}`}>
                {checked && <IconCheck size={13} stroke={3} />}
            </span>
            <span className={classes.toggleLabel}>{label}</span>
        </div>
    );
}

export function CarbonFooter({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
    return (
        <div className={classes.footer}>
            <span className={classes.hint}>{hint}</span>
            <div className={classes.actions}>{children}</div>
        </div>
    );
}

export function CarbonSubmit({ loading, children }: { loading?: boolean; children: ReactNode }) {
    return (
        <button type="submit" className={classes.btnPrimary} disabled={loading}>
            {children}
            <IconArrowRight size={17} stroke={2} />
        </button>
    );
}

export function CarbonGhostButton({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
    return (
        <button type="button" className={classes.btnGhost} onClick={onClick}>
            {children}
        </button>
    );
}

export const carbonClasses = classes;
