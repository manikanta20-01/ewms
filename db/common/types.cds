namespace ewms.db.common;

/* Generic Business Code */

type BusinessCode : String(20);

/* Names */

type Name50 : String(50);
type Name100 : String(100);
type Name150 : String(150);

/* Description */

type Description : String(255);

/* Contact */

type Phone : String(20);
type Email : String(100);
type URL : String(255);

/* Address */

type Country : String(50);
type State : String(50);
type City : String(50);
type PostalCode : String(10);
type TimeZone : String(50);

/* Finance */

type Currency : String(3);
type Amount : Decimal(15,2);
type Percentage : Decimal(5,2);

/* HR */

type Hours : Decimal(5,2);