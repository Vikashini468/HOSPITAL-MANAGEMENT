"""
Explainable AI module for the hospital prediction service.

Reuses the existing SHAP/TreeExplainer approach (see explain_hypertension.py)
and adds a compatibility shim for xgboost >= 3.1 (base_score string/list bug,
the official fix from shap PR #4187). No model is retrained or modified here —
the explainer is only called AFTER a prediction has been made.

Usage:
    import explainable_ai
    result = explainable_ai.explain(model, patient_df, disease="Diabetes",
                                    prediction="HIGH RISK", probability=89.08,
                                    confidence=89.08, top_n=5)
"""

import ast
import warnings

import numpy as np
import pandas as pd

import shap
from shap.explainers import _tree

# ============================================================
# XGBOOST >= 3.1 COMPATIBILITY SHIM
# xgboost 3.1+ serializes learner_model_param["base_score"] as a
# list (e.g. "[6.2725E-1]") which breaks shap's XGBTreeModelLoader.
# Patch the UBJSON decode step once at import time.
# ============================================================
_orig_decode_ubjson = _tree.decode_ubjson_buffer


def _patched_decode_ubjson(fd):
    jmodel = _orig_decode_ubjson(fd)
    try:
        lmp = jmodel["learner"]["learner_model_param"]
        bs = lmp.get("base_score")
        if isinstance(bs, (str, bytes)):
            s = bs.decode() if isinstance(bs, bytes) else bs
            try:
                bs = ast.literal_eval(s)
            except Exception:
                pass
        if isinstance(bs, (list, tuple, np.ndarray)):
            bs = bs[0]
        lmp["base_score"] = float(bs)
    except Exception:
        pass
    return jmodel


_tree.decode_ubjson_buffer = _patched_decode_ubjson

# ============================================================
# EXPLAINER CACHE — one TreeExplainer per model, built lazily
# ============================================================
_EXPLAINERS = {}


def _get_explainer(inner_model):
    key = id(inner_model)
    if key not in _EXPLAINERS:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            _EXPLAINERS[key] = shap.TreeExplainer(inner_model)
    return _EXPLAINERS[key]


def _clean_feature_name(name):
    """Turn preprocessor output names into readable labels.

    'numerical__age'            -> 'age'
    'categorical__gender_Male'  -> 'gender: Male'
    'cat__alcohol_Occasional'   -> 'alcohol: Occasional'
    Numeric features keep their full name (e.g. 'glucose_mg_dl').
    """
    name = str(name)
    prefix, _, rest = name.partition("__")
    if rest:
        name = rest
        if prefix.startswith(("cat", "categorical", "onehot")):
            parts = name.split("_")
            if len(parts) > 1:
                base, value = "_".join(parts[:-1]), parts[-1]
                if base and value:
                    return f"{base}: {value}"
    return name


def _extract_model(model):
    """Return (inner_model, feature_labels) for a model or sklearn Pipeline."""
    if hasattr(model, "named_steps") and "preprocessor" in model.named_steps:
        preprocessor = model.named_steps["preprocessor"]
        inner = model.named_steps["model"]
        try:
            labels = preprocessor.get_feature_names_out()
        except Exception:
            labels = None
        return inner, labels
    if hasattr(model, "feature_name_"):
        return model, list(model.feature_name_)
    return model, None


def explain(model, patient_df, disease="", prediction="", probability=0.0,
            confidence=0.0, top_n=5):
    """Compute SHAP-based explanation for a single-patient prediction.

    Args:
        model: loaded model (sklearn Pipeline or raw tree model).
        patient_df: single-row DataFrame matching the model's input columns.
        disease: display name of the disease (e.g. "Diabetes").
        prediction: model prediction label already computed.
        probability: model probability already computed.
        confidence: confidence score already computed.
        top_n: number of top contributing features to return.

    Returns:
        dict with keys:
            disease, prediction, probability, confidence,
            top_features (list of names),
            feature_importance (list of {feature, importance}),
            explanation (human-readable summary).
    """
    inner, labels = _extract_model(model)

    if hasattr(model, "named_steps") and "preprocessor" in model.named_steps:
        preprocessor = model.named_steps["preprocessor"]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            X = preprocessor.transform(patient_df)
        X = pd.DataFrame(X)
    else:
        X = patient_df.copy()

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        explainer = _get_explainer(inner)
        sv = explainer.shap_values(X)

    if isinstance(sv, list):
        sv = sv[1] if len(sv) > 1 else sv[0]

    sv = np.asarray(sv)

    # Binary classifiers can return (samples, features, classes) — keep the
    # positive class (index 1), which matches the predicted risk class.
    if sv.ndim == 3:
        sv = sv[:, :, 1]
    elif sv.ndim == 2 and sv.shape[0] == 1 and sv.shape[1] != X.shape[1]:
        sv = sv.reshape(1, -1)

    sv = sv.reshape(1, -1)[0]

    if labels is None or len(labels) != len(sv):
        labels = list(X.columns)

    readable = [_clean_feature_name(n) for n in labels]

    contributions = sorted(zip(readable, sv), key=lambda t: abs(t[1]), reverse=True)
    top = contributions[:top_n]

    importance = [
        {"feature": f, "importance": round(float(v), 4)} for f, v in top
    ]

    summary = _build_summary(disease, prediction, probability, confidence, top)

    return {
        "disease":           disease,
        "prediction":        prediction,
        "probability":       probability,
        "confidence":        confidence,
        "top_features":      [f for f, _ in top],
        "feature_importance": importance,
        "explanation":       summary
    }


def _build_summary(disease, prediction, probability, confidence, top):
    parts = []
    for i, (name, val) in enumerate(top, 1):
        direction = "increases" if val >= 0 else "decreases"
        parts.append(f"{name} ({'+' if val >= 0 else ''}{val:.2f}, {direction} risk)")
    lead = ", ".join(parts) if parts else "no dominant features"
    return (
        f"{disease} prediction is {prediction} "
        f"(risk probability {probability:.2f}%, confidence {confidence:.2f}%). "
        f"Top contributing factors: {lead}. Positive values push risk up, "
        f"negative values push it down."
    )
