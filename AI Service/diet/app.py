from flask import Flask, request, jsonify
import joblib
import pandas as pd
import os
import warnings

warnings.filterwarnings("ignore")

app = Flask(__name__)

# ── Model loading ────────────────────────────────────────────────────────────
BASE = os.path.join(os.path.dirname(__file__), "models")
diet_model = joblib.load(os.path.join(BASE, "diet_recommendation_model.pkl"))
food_model = joblib.load(os.path.join(BASE, "food_recommendation_model.pkl"))
meal_model = joblib.load(os.path.join(BASE, "meal_type_model.pkl"))

# ── Field definitions ────────────────────────────────────────────────────────
REQUIRED_NUMERIC = [
    "age", "height_cm", "weight_kg", "bmi",
    "daily_steps", "exercise_hours", "sleep_hours", "water_intake_liters",
    "fasting_glucose", "hba1c",
    "systolic_bp", "diastolic_bp",
    "total_cholesterol", "ldl", "hdl", "triglycerides",
    "daily_calorie_target",
]

REQUIRED_CATEGORICAL = [
    "gender",           # Male | Female
    "activity_level",   # Low | Moderate | High
    "diet_preference",  # Vegetarian | Non-Vegetarian | Vegan
    "diabetes",         # Yes | No
    "hypertension",     # Yes | No
    "cardiovascular_disease",  # Yes | No
    "goal",             # Weight_Loss | Weight_Maintenance | Muscle_Gain | Healthy_Lifestyle
]

# Optional — sensible defaults when absent
OPTIONAL_DEFAULTS = {
    "medical_history":      "None",
    "symptoms":             "None",
    "dietary_restrictions": "None",
    "allergies":            "None",
    "preferred_cuisine":    "Indian",
    "recommended_food":     "None",
    "meal_type":            "None",
}

ALL_FEATURES = REQUIRED_NUMERIC + REQUIRED_CATEGORICAL + list(OPTIONAL_DEFAULTS.keys())


# ── Helpers ──────────────────────────────────────────────────────────────────
def validate(data: dict) -> list[str]:
    errors = []
    for field in REQUIRED_NUMERIC:
        val = data.get(field)
        if val is None:
            errors.append(f"'{field}' is required.")
        else:
            try:
                float(val)
            except (TypeError, ValueError):
                errors.append(f"'{field}' must be a number.")
    for field in REQUIRED_CATEGORICAL:
        if data.get(field) is None:
            errors.append(f"'{field}' is required.")
    return errors


def build_df(data: dict) -> pd.DataFrame:
    row = {}
    for f in REQUIRED_NUMERIC:
        row[f] = float(data[f])
    for f in REQUIRED_CATEGORICAL:
        row[f] = data[f]
    for f, default in OPTIONAL_DEFAULTS.items():
        row[f] = data.get(f, default)
    return pd.DataFrame([row])


# ── Routes ───────────────────────────────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/predict-diet", methods=["POST"])
def predict_diet():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    errors = validate(data)
    if errors:
        return jsonify({"error": "Validation failed.", "details": errors}), 422

    try:
        df = build_df(data)
        return jsonify({
            "recommended_diet": diet_model.predict(df)[0],
            "recommended_food": food_model.predict(df)[0],
            "meal_type":        meal_model.predict(df)[0],
        })
    except Exception as e:
        return jsonify({"error": "Prediction failed.", "details": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5051)
