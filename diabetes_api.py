from flask import Flask, request, jsonify
import joblib
import pandas as pd
import os

import explainable_ai

app = Flask(__name__)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "diabetes_risk_model.pkl")
model = joblib.load(MODEL_PATH)

FEATURES = [
    "age", "gender", "bmi", "systolic_bp", "diastolic_bp",
    "heart_rate", "glucose_mg_dl", "hba1c_percent",
    "total_cholesterol_mg_dl", "hdl_mg_dl", "ldl_mg_dl",
    "triglycerides_mg_dl", "family_history_diabetes",
    "smoking", "alcohol", "physical_activity", "diet_quality",
    "sleep_hours", "fatigue", "excessive_thirst", "frequent_urination"
]

def _diabetes_response(request):
    """Shared Diabetes prediction handler used by /predict and /predict/diabetes."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No input data"}), 400

        patient_df = pd.DataFrame([{f: data.get(f) for f in FEATURES}])

        probability = float(model.predict_proba(patient_df)[0][1])
        prediction  = "HIGH RISK" if probability >= 0.50 else "LOW RISK"

        confidence = round(max(probability, 1 - probability) * 100, 2)

        explanation = explainable_ai.explain(
            model, patient_df, disease="Diabetes",
            prediction=prediction,
            probability=round(probability * 100, 2),
            confidence=confidence,
            top_n=5
        )

        return jsonify({
            "prediction":  prediction,
            "probability": round(probability * 100, 2),
            "threshold":   50.0,
            "confidence":  confidence,
            "disease":     "Diabetes",
            "top_features":     explanation["top_features"],
            "feature_importance": explanation["feature_importance"],
            "explanation":       explanation["explanation"]
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/predict", methods=["POST"])
def predict():
    return _diabetes_response(request)

@app.route("/predict/diabetes", methods=["POST"])
def predict_diabetes():
    return _diabetes_response(request)

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

# ============================================================
# HYPERTENSION MODEL — loaded ONCE at service startup
# Independent of the Diabetes model.
# ============================================================
HYPERTENSION_MODEL_PATH = os.path.join(os.path.dirname(__file__), "hypertension_risk_model.pkl")
hypertension_model = joblib.load(HYPERTENSION_MODEL_PATH)

HYPERTENSION_FEATURES = [
    "age", "gender", "bmi", "systolic_bp", "diastolic_bp", "heart_rate",
    "total_cholesterol_mg_dl", "hdl_mg_dl", "ldl_mg_dl", "triglycerides_mg_dl",
    "creatinine_mg_dl", "family_history_hypertension",
    "smoking", "alcohol", "physical_activity", "diet_quality",
    "sleep_hours", "headache", "dizziness", "chest_pain", "breathlessness"
]

@app.route("/predict/hypertension", methods=["POST"])
def predict_hypertension():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No input data"}), 400

        patient = {
            "age":                      data.get("age"),
            "gender":                   data.get("gender") or "Male",
            "bmi":                      data.get("bmi"),
            "systolic_bp":              data.get("systolic_bp"),
            "diastolic_bp":             data.get("diastolic_bp"),
            "heart_rate":               data.get("heart_rate"),
            "total_cholesterol_mg_dl":  data.get("total_cholesterol_mg_dl"),
            "hdl_mg_dl":                data.get("hdl_mg_dl"),
            "ldl_mg_dl":                data.get("ldl_mg_dl"),
            "triglycerides_mg_dl":      data.get("triglycerides_mg_dl"),
            "creatinine_mg_dl":         data.get("creatinine_mg_dl"),
            "family_history_hypertension": data.get("family_history_hypertension")
                                         or data.get("family_history_diabetes") or "No",
            "smoking":                  data.get("smoking"),
            "alcohol":                  data.get("alcohol"),
            "physical_activity":        data.get("physical_activity"),
            "diet_quality":             data.get("diet_quality"),
            "sleep_hours":              data.get("sleep_hours"),
            "headache":                 data.get("headache", 0),
            "dizziness":                data.get("dizziness", 0),
            "chest_pain":               data.get("chest_pain", 0),
            "breathlessness":           data.get("breathlessness", 0)
        }

        patient_df = pd.DataFrame([{f: patient[f] for f in HYPERTENSION_FEATURES}])

        probability = float(hypertension_model.predict_proba(patient_df)[0][1])
        prediction  = "Positive" if probability >= 0.50 else "Negative"
        confidence  = round(max(probability, 1 - probability) * 100, 1)

        explanation = explainable_ai.explain(
            hypertension_model, patient_df, disease="Hypertension",
            prediction=prediction,
            probability=round(probability * 100, 2),
            confidence=confidence,
            top_n=5
        )

        return jsonify({
            "disease":    "Hypertension",
            "prediction": prediction,
            "probability": round(probability, 4),
            "confidence": confidence,
            "top_features":      explanation["top_features"],
            "feature_importance": explanation["feature_importance"],
            "explanation":        explanation["explanation"]
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ============================================================
# CARDIOVASCULAR MODEL — loaded ONCE at service startup
# Independent of the Diabetes and Hypertension models.
# ============================================================
CARDIO_MODEL_PATH = os.path.join(os.path.dirname(__file__), "lightgbm_cardiovascular_model.pkl")
cardio_model = joblib.load(CARDIO_MODEL_PATH)

CARDIO_FEATURES = [
    "age", "gender", "height", "weight", "ap_hi", "ap_lo",
    "cholesterol", "gluc", "smoke", "alco", "active"
]

@app.route("/predict/cardiovascular", methods=["POST"])
def predict_cardiovascular():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No input data"}), 400

        patient = {
            "age":         data.get("age"),
            "gender":      data.get("gender", 1),
            "height":      data.get("height"),
            "weight":      data.get("weight"),
            "ap_hi":       data.get("ap_hi"),
            "ap_lo":       data.get("ap_lo"),
            "cholesterol": data.get("cholesterol", 1),
            "gluc":        data.get("gluc", 1),
            "smoke":       data.get("smoke", 0),
            "alco":        data.get("alco", 0),
            "active":      data.get("active", 1)
        }

        patient_df = pd.DataFrame([{f: patient[f] for f in CARDIO_FEATURES}])
        # Missing vitals arrive as null -> coerce to NaN (float64) so the
        # raw LightGBM model (no imputer) can still run.
        patient_df = patient_df.apply(pd.to_numeric, errors="coerce")

        probability = float(cardio_model.predict_proba(patient_df)[0][1])
        prediction  = "Positive" if probability >= 0.50 else "Negative"
        confidence  = round(max(probability, 1 - probability) * 100, 1)

        explanation = explainable_ai.explain(
            cardio_model, patient_df, disease="Cardiovascular Disease",
            prediction=prediction,
            probability=round(probability * 100, 2),
            confidence=confidence,
            top_n=5
        )

        return jsonify({
            "disease":    "Cardiovascular Disease",
            "prediction": prediction,
            "probability": round(probability, 4),
            "confidence": confidence,
            "top_features":      explanation["top_features"],
            "feature_importance": explanation["feature_importance"],
            "explanation":        explanation["explanation"]
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050)
