package com.watchfitre.protocol

/**
 * Confidence ladder for every documented protocol fact (PRD §13).
 *
 * UNKNOWN     — nothing yet.
 * HYPOTHESIS  — plausible guess, unsupported by capture.
 * OBSERVED    — seen in real traffic, correlation not proven.
 * REPRODUCED  — replayed against the watch, got the same result.
 * VERIFIED    — reproduced reliably across sessions / devices / reboots.
 *
 * Rule: a command may not be marked above HYPOTHESIS until experimentally confirmed.
 */
enum class ConfidenceLevel {
    UNKNOWN,
    HYPOTHESIS,
    OBSERVED,
    REPRODUCED,
    VERIFIED,
    ;

    val isActionable: Boolean get() = this == REPRODUCED || this == VERIFIED
}
