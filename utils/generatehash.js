const bcrypt = require("bcrypt");

bcrypt.hash("Admin@123", 10).then(hash => {
    console.log("HASH:", hash);
});