CREATE TABLE IF NOT EXISTS salary_payments (
    id             SERIAL PRIMARY KEY,
    employee_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month          VARCHAR(20) NOT NULL,
    year           VARCHAR(4)  NOT NULL,
    salary         NUMERIC(12,2) DEFAULT 0,
    status         VARCHAR(20)   DEFAULT 'Pending',
    payment_date   TIMESTAMP,
    UNIQUE (employee_id, month, year)
);
