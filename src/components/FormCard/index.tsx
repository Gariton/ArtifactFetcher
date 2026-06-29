import { Box, Group } from "@mantine/core";
import { ReactNode } from "react";
import classes from "./styles.module.css";

/**
 * Bordered form container with an optional action footer
 * (hint text on the left, buttons on the right) — Carbon design.
 */
export function FormCard({
    children,
    hint,
    actions,
}: {
    children: ReactNode;
    hint?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <Box className={classes.card}>
            <Box className={classes.body}>{children}</Box>
            {(hint || actions) && (
                <Group className={classes.footer} justify="space-between" wrap="nowrap">
                    <Box style={{ minWidth: 0 }}>{hint}</Box>
                    <Group gap="sm" wrap="nowrap" style={{ flex: "none" }}>{actions}</Group>
                </Group>
            )}
        </Box>
    );
}
