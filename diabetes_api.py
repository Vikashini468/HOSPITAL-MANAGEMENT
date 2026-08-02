from flask import Flask, request, jsonify
import joblib
import pandas as pd
import os

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

@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No input data"}), 400

        patient_df = pd.DataFrame([{f: data.get(f) for f in FEATURES}])

        probability = float(model.predict_proba(patient_df)[0][1])
        prediction  = "HIGH RISK" if probability >= 0.50 else "LOW RISK"

        return jsonify({
            "prediction":  prediction,
            "probability": round(probability * 100, 2),
            "threshold":   50.0
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050)
