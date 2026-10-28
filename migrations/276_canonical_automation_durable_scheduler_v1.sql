-- Mission 28 Part 6B: durable, tenant-private schedule evidence for one
-- accepted Part 6A action unit. This migration mounts no timer, publisher,
-- consumer, worker, lease, provider, recipient or external-effect path.

CREATE TABLE public.canonical_automation_canonical_time_zones_v1 (
 tenant_time_zone TEXT PRIMARY KEY,
 catalog TEXT NOT NULL CHECK(catalog='node22.23.3_intl_supported_values_v1'),
 CHECK(octet_length(tenant_time_zone) BETWEEN 3 AND 64)
);

INSERT INTO public.canonical_automation_canonical_time_zones_v1(tenant_time_zone,catalog) VALUES
 ('Africa/Abidjan','node22.23.3_intl_supported_values_v1'),
 ('Africa/Accra','node22.23.3_intl_supported_values_v1'),
 ('Africa/Addis_Ababa','node22.23.3_intl_supported_values_v1'),
 ('Africa/Algiers','node22.23.3_intl_supported_values_v1'),
 ('Africa/Asmera','node22.23.3_intl_supported_values_v1'),
 ('Africa/Bamako','node22.23.3_intl_supported_values_v1'),
 ('Africa/Bangui','node22.23.3_intl_supported_values_v1'),
 ('Africa/Banjul','node22.23.3_intl_supported_values_v1'),
 ('Africa/Bissau','node22.23.3_intl_supported_values_v1'),
 ('Africa/Blantyre','node22.23.3_intl_supported_values_v1'),
 ('Africa/Brazzaville','node22.23.3_intl_supported_values_v1'),
 ('Africa/Bujumbura','node22.23.3_intl_supported_values_v1'),
 ('Africa/Cairo','node22.23.3_intl_supported_values_v1'),
 ('Africa/Casablanca','node22.23.3_intl_supported_values_v1'),
 ('Africa/Ceuta','node22.23.3_intl_supported_values_v1'),
 ('Africa/Conakry','node22.23.3_intl_supported_values_v1'),
 ('Africa/Dakar','node22.23.3_intl_supported_values_v1'),
 ('Africa/Dar_es_Salaam','node22.23.3_intl_supported_values_v1'),
 ('Africa/Djibouti','node22.23.3_intl_supported_values_v1'),
 ('Africa/Douala','node22.23.3_intl_supported_values_v1'),
 ('Africa/El_Aaiun','node22.23.3_intl_supported_values_v1'),
 ('Africa/Freetown','node22.23.3_intl_supported_values_v1'),
 ('Africa/Gaborone','node22.23.3_intl_supported_values_v1'),
 ('Africa/Harare','node22.23.3_intl_supported_values_v1'),
 ('Africa/Johannesburg','node22.23.3_intl_supported_values_v1'),
 ('Africa/Juba','node22.23.3_intl_supported_values_v1'),
 ('Africa/Kampala','node22.23.3_intl_supported_values_v1'),
 ('Africa/Khartoum','node22.23.3_intl_supported_values_v1'),
 ('Africa/Kigali','node22.23.3_intl_supported_values_v1'),
 ('Africa/Kinshasa','node22.23.3_intl_supported_values_v1'),
 ('Africa/Lagos','node22.23.3_intl_supported_values_v1'),
 ('Africa/Libreville','node22.23.3_intl_supported_values_v1'),
 ('Africa/Lome','node22.23.3_intl_supported_values_v1'),
 ('Africa/Luanda','node22.23.3_intl_supported_values_v1'),
 ('Africa/Lubumbashi','node22.23.3_intl_supported_values_v1'),
 ('Africa/Lusaka','node22.23.3_intl_supported_values_v1'),
 ('Africa/Malabo','node22.23.3_intl_supported_values_v1'),
 ('Africa/Maputo','node22.23.3_intl_supported_values_v1'),
 ('Africa/Maseru','node22.23.3_intl_supported_values_v1'),
 ('Africa/Mbabane','node22.23.3_intl_supported_values_v1'),
 ('Africa/Mogadishu','node22.23.3_intl_supported_values_v1'),
 ('Africa/Monrovia','node22.23.3_intl_supported_values_v1'),
 ('Africa/Nairobi','node22.23.3_intl_supported_values_v1'),
 ('Africa/Ndjamena','node22.23.3_intl_supported_values_v1'),
 ('Africa/Niamey','node22.23.3_intl_supported_values_v1'),
 ('Africa/Nouakchott','node22.23.3_intl_supported_values_v1'),
 ('Africa/Ouagadougou','node22.23.3_intl_supported_values_v1'),
 ('Africa/Porto-Novo','node22.23.3_intl_supported_values_v1'),
 ('Africa/Sao_Tome','node22.23.3_intl_supported_values_v1'),
 ('Africa/Tripoli','node22.23.3_intl_supported_values_v1'),
 ('Africa/Tunis','node22.23.3_intl_supported_values_v1'),
 ('Africa/Windhoek','node22.23.3_intl_supported_values_v1'),
 ('America/Adak','node22.23.3_intl_supported_values_v1'),
 ('America/Anchorage','node22.23.3_intl_supported_values_v1'),
 ('America/Anguilla','node22.23.3_intl_supported_values_v1'),
 ('America/Antigua','node22.23.3_intl_supported_values_v1'),
 ('America/Araguaina','node22.23.3_intl_supported_values_v1'),
 ('America/Argentina/La_Rioja','node22.23.3_intl_supported_values_v1'),
 ('America/Argentina/Rio_Gallegos','node22.23.3_intl_supported_values_v1'),
 ('America/Argentina/Salta','node22.23.3_intl_supported_values_v1'),
 ('America/Argentina/San_Juan','node22.23.3_intl_supported_values_v1'),
 ('America/Argentina/San_Luis','node22.23.3_intl_supported_values_v1'),
 ('America/Argentina/Tucuman','node22.23.3_intl_supported_values_v1'),
 ('America/Argentina/Ushuaia','node22.23.3_intl_supported_values_v1'),
 ('America/Aruba','node22.23.3_intl_supported_values_v1'),
 ('America/Asuncion','node22.23.3_intl_supported_values_v1'),
 ('America/Bahia','node22.23.3_intl_supported_values_v1'),
 ('America/Bahia_Banderas','node22.23.3_intl_supported_values_v1'),
 ('America/Barbados','node22.23.3_intl_supported_values_v1'),
 ('America/Belem','node22.23.3_intl_supported_values_v1'),
 ('America/Belize','node22.23.3_intl_supported_values_v1'),
 ('America/Blanc-Sablon','node22.23.3_intl_supported_values_v1'),
 ('America/Boa_Vista','node22.23.3_intl_supported_values_v1'),
 ('America/Bogota','node22.23.3_intl_supported_values_v1'),
 ('America/Boise','node22.23.3_intl_supported_values_v1'),
 ('America/Buenos_Aires','node22.23.3_intl_supported_values_v1'),
 ('America/Cambridge_Bay','node22.23.3_intl_supported_values_v1'),
 ('America/Campo_Grande','node22.23.3_intl_supported_values_v1'),
 ('America/Cancun','node22.23.3_intl_supported_values_v1'),
 ('America/Caracas','node22.23.3_intl_supported_values_v1'),
 ('America/Catamarca','node22.23.3_intl_supported_values_v1'),
 ('America/Cayenne','node22.23.3_intl_supported_values_v1'),
 ('America/Cayman','node22.23.3_intl_supported_values_v1'),
 ('America/Chicago','node22.23.3_intl_supported_values_v1'),
 ('America/Chihuahua','node22.23.3_intl_supported_values_v1'),
 ('America/Ciudad_Juarez','node22.23.3_intl_supported_values_v1'),
 ('America/Coral_Harbour','node22.23.3_intl_supported_values_v1'),
 ('America/Cordoba','node22.23.3_intl_supported_values_v1'),
 ('America/Costa_Rica','node22.23.3_intl_supported_values_v1'),
 ('America/Coyhaique','node22.23.3_intl_supported_values_v1'),
 ('America/Creston','node22.23.3_intl_supported_values_v1'),
 ('America/Cuiaba','node22.23.3_intl_supported_values_v1'),
 ('America/Curacao','node22.23.3_intl_supported_values_v1'),
 ('America/Danmarkshavn','node22.23.3_intl_supported_values_v1'),
 ('America/Dawson','node22.23.3_intl_supported_values_v1'),
 ('America/Dawson_Creek','node22.23.3_intl_supported_values_v1'),
 ('America/Denver','node22.23.3_intl_supported_values_v1'),
 ('America/Detroit','node22.23.3_intl_supported_values_v1'),
 ('America/Dominica','node22.23.3_intl_supported_values_v1'),
 ('America/Edmonton','node22.23.3_intl_supported_values_v1'),
 ('America/Eirunepe','node22.23.3_intl_supported_values_v1'),
 ('America/El_Salvador','node22.23.3_intl_supported_values_v1'),
 ('America/Fort_Nelson','node22.23.3_intl_supported_values_v1'),
 ('America/Fortaleza','node22.23.3_intl_supported_values_v1'),
 ('America/Glace_Bay','node22.23.3_intl_supported_values_v1'),
 ('America/Godthab','node22.23.3_intl_supported_values_v1'),
 ('America/Goose_Bay','node22.23.3_intl_supported_values_v1'),
 ('America/Grand_Turk','node22.23.3_intl_supported_values_v1'),
 ('America/Grenada','node22.23.3_intl_supported_values_v1'),
 ('America/Guadeloupe','node22.23.3_intl_supported_values_v1'),
 ('America/Guatemala','node22.23.3_intl_supported_values_v1'),
 ('America/Guayaquil','node22.23.3_intl_supported_values_v1'),
 ('America/Guyana','node22.23.3_intl_supported_values_v1'),
 ('America/Halifax','node22.23.3_intl_supported_values_v1'),
 ('America/Havana','node22.23.3_intl_supported_values_v1'),
 ('America/Hermosillo','node22.23.3_intl_supported_values_v1'),
 ('America/Indiana/Knox','node22.23.3_intl_supported_values_v1'),
 ('America/Indiana/Marengo','node22.23.3_intl_supported_values_v1'),
 ('America/Indiana/Petersburg','node22.23.3_intl_supported_values_v1'),
 ('America/Indiana/Tell_City','node22.23.3_intl_supported_values_v1'),
 ('America/Indiana/Vevay','node22.23.3_intl_supported_values_v1'),
 ('America/Indiana/Vincennes','node22.23.3_intl_supported_values_v1'),
 ('America/Indiana/Winamac','node22.23.3_intl_supported_values_v1'),
 ('America/Indianapolis','node22.23.3_intl_supported_values_v1'),
 ('America/Inuvik','node22.23.3_intl_supported_values_v1'),
 ('America/Iqaluit','node22.23.3_intl_supported_values_v1'),
 ('America/Jamaica','node22.23.3_intl_supported_values_v1'),
 ('America/Jujuy','node22.23.3_intl_supported_values_v1'),
 ('America/Juneau','node22.23.3_intl_supported_values_v1'),
 ('America/Kentucky/Monticello','node22.23.3_intl_supported_values_v1'),
 ('America/Kralendijk','node22.23.3_intl_supported_values_v1'),
 ('America/La_Paz','node22.23.3_intl_supported_values_v1'),
 ('America/Lima','node22.23.3_intl_supported_values_v1'),
 ('America/Los_Angeles','node22.23.3_intl_supported_values_v1'),
 ('America/Louisville','node22.23.3_intl_supported_values_v1'),
 ('America/Lower_Princes','node22.23.3_intl_supported_values_v1'),
 ('America/Maceio','node22.23.3_intl_supported_values_v1'),
 ('America/Managua','node22.23.3_intl_supported_values_v1'),
 ('America/Manaus','node22.23.3_intl_supported_values_v1'),
 ('America/Marigot','node22.23.3_intl_supported_values_v1'),
 ('America/Martinique','node22.23.3_intl_supported_values_v1'),
 ('America/Matamoros','node22.23.3_intl_supported_values_v1'),
 ('America/Mazatlan','node22.23.3_intl_supported_values_v1'),
 ('America/Mendoza','node22.23.3_intl_supported_values_v1'),
 ('America/Menominee','node22.23.3_intl_supported_values_v1'),
 ('America/Merida','node22.23.3_intl_supported_values_v1'),
 ('America/Metlakatla','node22.23.3_intl_supported_values_v1'),
 ('America/Mexico_City','node22.23.3_intl_supported_values_v1'),
 ('America/Miquelon','node22.23.3_intl_supported_values_v1'),
 ('America/Moncton','node22.23.3_intl_supported_values_v1'),
 ('America/Monterrey','node22.23.3_intl_supported_values_v1'),
 ('America/Montevideo','node22.23.3_intl_supported_values_v1'),
 ('America/Montserrat','node22.23.3_intl_supported_values_v1'),
 ('America/Nassau','node22.23.3_intl_supported_values_v1'),
 ('America/New_York','node22.23.3_intl_supported_values_v1'),
 ('America/Nome','node22.23.3_intl_supported_values_v1'),
 ('America/Noronha','node22.23.3_intl_supported_values_v1'),
 ('America/North_Dakota/Beulah','node22.23.3_intl_supported_values_v1'),
 ('America/North_Dakota/Center','node22.23.3_intl_supported_values_v1'),
 ('America/North_Dakota/New_Salem','node22.23.3_intl_supported_values_v1'),
 ('America/Ojinaga','node22.23.3_intl_supported_values_v1'),
 ('America/Panama','node22.23.3_intl_supported_values_v1'),
 ('America/Paramaribo','node22.23.3_intl_supported_values_v1'),
 ('America/Phoenix','node22.23.3_intl_supported_values_v1'),
 ('America/Port-au-Prince','node22.23.3_intl_supported_values_v1'),
 ('America/Port_of_Spain','node22.23.3_intl_supported_values_v1'),
 ('America/Porto_Velho','node22.23.3_intl_supported_values_v1'),
 ('America/Puerto_Rico','node22.23.3_intl_supported_values_v1'),
 ('America/Punta_Arenas','node22.23.3_intl_supported_values_v1'),
 ('America/Rankin_Inlet','node22.23.3_intl_supported_values_v1'),
 ('America/Recife','node22.23.3_intl_supported_values_v1'),
 ('America/Regina','node22.23.3_intl_supported_values_v1'),
 ('America/Resolute','node22.23.3_intl_supported_values_v1'),
 ('America/Rio_Branco','node22.23.3_intl_supported_values_v1'),
 ('America/Santarem','node22.23.3_intl_supported_values_v1'),
 ('America/Santiago','node22.23.3_intl_supported_values_v1'),
 ('America/Santo_Domingo','node22.23.3_intl_supported_values_v1'),
 ('America/Sao_Paulo','node22.23.3_intl_supported_values_v1'),
 ('America/Scoresbysund','node22.23.3_intl_supported_values_v1'),
 ('America/Sitka','node22.23.3_intl_supported_values_v1'),
 ('America/St_Barthelemy','node22.23.3_intl_supported_values_v1'),
 ('America/St_Johns','node22.23.3_intl_supported_values_v1'),
 ('America/St_Kitts','node22.23.3_intl_supported_values_v1'),
 ('America/St_Lucia','node22.23.3_intl_supported_values_v1'),
 ('America/St_Thomas','node22.23.3_intl_supported_values_v1'),
 ('America/St_Vincent','node22.23.3_intl_supported_values_v1'),
 ('America/Swift_Current','node22.23.3_intl_supported_values_v1'),
 ('America/Tegucigalpa','node22.23.3_intl_supported_values_v1'),
 ('America/Thule','node22.23.3_intl_supported_values_v1'),
 ('America/Tijuana','node22.23.3_intl_supported_values_v1'),
 ('America/Toronto','node22.23.3_intl_supported_values_v1'),
 ('America/Tortola','node22.23.3_intl_supported_values_v1'),
 ('America/Vancouver','node22.23.3_intl_supported_values_v1'),
 ('America/Whitehorse','node22.23.3_intl_supported_values_v1'),
 ('America/Winnipeg','node22.23.3_intl_supported_values_v1'),
 ('America/Yakutat','node22.23.3_intl_supported_values_v1'),
 ('Antarctica/Casey','node22.23.3_intl_supported_values_v1'),
 ('Antarctica/Davis','node22.23.3_intl_supported_values_v1'),
 ('Antarctica/DumontDUrville','node22.23.3_intl_supported_values_v1'),
 ('Antarctica/Macquarie','node22.23.3_intl_supported_values_v1'),
 ('Antarctica/Mawson','node22.23.3_intl_supported_values_v1'),
 ('Antarctica/McMurdo','node22.23.3_intl_supported_values_v1'),
 ('Antarctica/Palmer','node22.23.3_intl_supported_values_v1'),
 ('Antarctica/Rothera','node22.23.3_intl_supported_values_v1'),
 ('Antarctica/Syowa','node22.23.3_intl_supported_values_v1'),
 ('Antarctica/Troll','node22.23.3_intl_supported_values_v1'),
 ('Antarctica/Vostok','node22.23.3_intl_supported_values_v1'),
 ('Arctic/Longyearbyen','node22.23.3_intl_supported_values_v1'),
 ('Asia/Aden','node22.23.3_intl_supported_values_v1'),
 ('Asia/Almaty','node22.23.3_intl_supported_values_v1'),
 ('Asia/Amman','node22.23.3_intl_supported_values_v1'),
 ('Asia/Anadyr','node22.23.3_intl_supported_values_v1'),
 ('Asia/Aqtau','node22.23.3_intl_supported_values_v1'),
 ('Asia/Aqtobe','node22.23.3_intl_supported_values_v1'),
 ('Asia/Ashgabat','node22.23.3_intl_supported_values_v1'),
 ('Asia/Atyrau','node22.23.3_intl_supported_values_v1'),
 ('Asia/Baghdad','node22.23.3_intl_supported_values_v1'),
 ('Asia/Bahrain','node22.23.3_intl_supported_values_v1'),
 ('Asia/Baku','node22.23.3_intl_supported_values_v1'),
 ('Asia/Bangkok','node22.23.3_intl_supported_values_v1'),
 ('Asia/Barnaul','node22.23.3_intl_supported_values_v1'),
 ('Asia/Beirut','node22.23.3_intl_supported_values_v1'),
 ('Asia/Bishkek','node22.23.3_intl_supported_values_v1'),
 ('Asia/Brunei','node22.23.3_intl_supported_values_v1'),
 ('Asia/Calcutta','node22.23.3_intl_supported_values_v1'),
 ('Asia/Chita','node22.23.3_intl_supported_values_v1'),
 ('Asia/Colombo','node22.23.3_intl_supported_values_v1'),
 ('Asia/Damascus','node22.23.3_intl_supported_values_v1'),
 ('Asia/Dhaka','node22.23.3_intl_supported_values_v1'),
 ('Asia/Dili','node22.23.3_intl_supported_values_v1'),
 ('Asia/Dubai','node22.23.3_intl_supported_values_v1'),
 ('Asia/Dushanbe','node22.23.3_intl_supported_values_v1'),
 ('Asia/Famagusta','node22.23.3_intl_supported_values_v1'),
 ('Asia/Gaza','node22.23.3_intl_supported_values_v1'),
 ('Asia/Hebron','node22.23.3_intl_supported_values_v1'),
 ('Asia/Hong_Kong','node22.23.3_intl_supported_values_v1'),
 ('Asia/Hovd','node22.23.3_intl_supported_values_v1'),
 ('Asia/Irkutsk','node22.23.3_intl_supported_values_v1'),
 ('Asia/Jakarta','node22.23.3_intl_supported_values_v1'),
 ('Asia/Jayapura','node22.23.3_intl_supported_values_v1'),
 ('Asia/Jerusalem','node22.23.3_intl_supported_values_v1'),
 ('Asia/Kabul','node22.23.3_intl_supported_values_v1'),
 ('Asia/Kamchatka','node22.23.3_intl_supported_values_v1'),
 ('Asia/Karachi','node22.23.3_intl_supported_values_v1'),
 ('Asia/Katmandu','node22.23.3_intl_supported_values_v1'),
 ('Asia/Khandyga','node22.23.3_intl_supported_values_v1'),
 ('Asia/Krasnoyarsk','node22.23.3_intl_supported_values_v1'),
 ('Asia/Kuala_Lumpur','node22.23.3_intl_supported_values_v1'),
 ('Asia/Kuching','node22.23.3_intl_supported_values_v1'),
 ('Asia/Kuwait','node22.23.3_intl_supported_values_v1'),
 ('Asia/Macau','node22.23.3_intl_supported_values_v1'),
 ('Asia/Magadan','node22.23.3_intl_supported_values_v1'),
 ('Asia/Makassar','node22.23.3_intl_supported_values_v1'),
 ('Asia/Manila','node22.23.3_intl_supported_values_v1'),
 ('Asia/Muscat','node22.23.3_intl_supported_values_v1'),
 ('Asia/Nicosia','node22.23.3_intl_supported_values_v1'),
 ('Asia/Novokuznetsk','node22.23.3_intl_supported_values_v1'),
 ('Asia/Novosibirsk','node22.23.3_intl_supported_values_v1'),
 ('Asia/Omsk','node22.23.3_intl_supported_values_v1'),
 ('Asia/Oral','node22.23.3_intl_supported_values_v1'),
 ('Asia/Phnom_Penh','node22.23.3_intl_supported_values_v1'),
 ('Asia/Pontianak','node22.23.3_intl_supported_values_v1'),
 ('Asia/Pyongyang','node22.23.3_intl_supported_values_v1'),
 ('Asia/Qatar','node22.23.3_intl_supported_values_v1'),
 ('Asia/Qostanay','node22.23.3_intl_supported_values_v1'),
 ('Asia/Qyzylorda','node22.23.3_intl_supported_values_v1'),
 ('Asia/Rangoon','node22.23.3_intl_supported_values_v1'),
 ('Asia/Riyadh','node22.23.3_intl_supported_values_v1'),
 ('Asia/Saigon','node22.23.3_intl_supported_values_v1'),
 ('Asia/Sakhalin','node22.23.3_intl_supported_values_v1'),
 ('Asia/Samarkand','node22.23.3_intl_supported_values_v1'),
 ('Asia/Seoul','node22.23.3_intl_supported_values_v1'),
 ('Asia/Shanghai','node22.23.3_intl_supported_values_v1'),
 ('Asia/Singapore','node22.23.3_intl_supported_values_v1'),
 ('Asia/Srednekolymsk','node22.23.3_intl_supported_values_v1'),
 ('Asia/Taipei','node22.23.3_intl_supported_values_v1'),
 ('Asia/Tashkent','node22.23.3_intl_supported_values_v1'),
 ('Asia/Tbilisi','node22.23.3_intl_supported_values_v1'),
 ('Asia/Tehran','node22.23.3_intl_supported_values_v1'),
 ('Asia/Thimphu','node22.23.3_intl_supported_values_v1'),
 ('Asia/Tokyo','node22.23.3_intl_supported_values_v1'),
 ('Asia/Tomsk','node22.23.3_intl_supported_values_v1'),
 ('Asia/Ulaanbaatar','node22.23.3_intl_supported_values_v1'),
 ('Asia/Urumqi','node22.23.3_intl_supported_values_v1'),
 ('Asia/Ust-Nera','node22.23.3_intl_supported_values_v1'),
 ('Asia/Vientiane','node22.23.3_intl_supported_values_v1'),
 ('Asia/Vladivostok','node22.23.3_intl_supported_values_v1'),
 ('Asia/Yakutsk','node22.23.3_intl_supported_values_v1'),
 ('Asia/Yekaterinburg','node22.23.3_intl_supported_values_v1'),
 ('Asia/Yerevan','node22.23.3_intl_supported_values_v1'),
 ('Atlantic/Azores','node22.23.3_intl_supported_values_v1'),
 ('Atlantic/Bermuda','node22.23.3_intl_supported_values_v1'),
 ('Atlantic/Canary','node22.23.3_intl_supported_values_v1'),
 ('Atlantic/Cape_Verde','node22.23.3_intl_supported_values_v1'),
 ('Atlantic/Faeroe','node22.23.3_intl_supported_values_v1'),
 ('Atlantic/Madeira','node22.23.3_intl_supported_values_v1'),
 ('Atlantic/Reykjavik','node22.23.3_intl_supported_values_v1'),
 ('Atlantic/South_Georgia','node22.23.3_intl_supported_values_v1'),
 ('Atlantic/St_Helena','node22.23.3_intl_supported_values_v1'),
 ('Atlantic/Stanley','node22.23.3_intl_supported_values_v1'),
 ('Australia/Adelaide','node22.23.3_intl_supported_values_v1'),
 ('Australia/Brisbane','node22.23.3_intl_supported_values_v1'),
 ('Australia/Broken_Hill','node22.23.3_intl_supported_values_v1'),
 ('Australia/Darwin','node22.23.3_intl_supported_values_v1'),
 ('Australia/Eucla','node22.23.3_intl_supported_values_v1'),
 ('Australia/Hobart','node22.23.3_intl_supported_values_v1'),
 ('Australia/Lindeman','node22.23.3_intl_supported_values_v1'),
 ('Australia/Lord_Howe','node22.23.3_intl_supported_values_v1'),
 ('Australia/Melbourne','node22.23.3_intl_supported_values_v1'),
 ('Australia/Perth','node22.23.3_intl_supported_values_v1'),
 ('Australia/Sydney','node22.23.3_intl_supported_values_v1'),
 ('Europe/Amsterdam','node22.23.3_intl_supported_values_v1'),
 ('Europe/Andorra','node22.23.3_intl_supported_values_v1'),
 ('Europe/Astrakhan','node22.23.3_intl_supported_values_v1'),
 ('Europe/Athens','node22.23.3_intl_supported_values_v1'),
 ('Europe/Belgrade','node22.23.3_intl_supported_values_v1'),
 ('Europe/Berlin','node22.23.3_intl_supported_values_v1'),
 ('Europe/Bratislava','node22.23.3_intl_supported_values_v1'),
 ('Europe/Brussels','node22.23.3_intl_supported_values_v1'),
 ('Europe/Bucharest','node22.23.3_intl_supported_values_v1'),
 ('Europe/Budapest','node22.23.3_intl_supported_values_v1'),
 ('Europe/Busingen','node22.23.3_intl_supported_values_v1'),
 ('Europe/Chisinau','node22.23.3_intl_supported_values_v1'),
 ('Europe/Copenhagen','node22.23.3_intl_supported_values_v1'),
 ('Europe/Dublin','node22.23.3_intl_supported_values_v1'),
 ('Europe/Gibraltar','node22.23.3_intl_supported_values_v1'),
 ('Europe/Guernsey','node22.23.3_intl_supported_values_v1'),
 ('Europe/Helsinki','node22.23.3_intl_supported_values_v1'),
 ('Europe/Isle_of_Man','node22.23.3_intl_supported_values_v1'),
 ('Europe/Istanbul','node22.23.3_intl_supported_values_v1'),
 ('Europe/Jersey','node22.23.3_intl_supported_values_v1'),
 ('Europe/Kaliningrad','node22.23.3_intl_supported_values_v1'),
 ('Europe/Kiev','node22.23.3_intl_supported_values_v1'),
 ('Europe/Kirov','node22.23.3_intl_supported_values_v1'),
 ('Europe/Lisbon','node22.23.3_intl_supported_values_v1'),
 ('Europe/Ljubljana','node22.23.3_intl_supported_values_v1'),
 ('Europe/London','node22.23.3_intl_supported_values_v1'),
 ('Europe/Luxembourg','node22.23.3_intl_supported_values_v1'),
 ('Europe/Madrid','node22.23.3_intl_supported_values_v1'),
 ('Europe/Malta','node22.23.3_intl_supported_values_v1'),
 ('Europe/Mariehamn','node22.23.3_intl_supported_values_v1'),
 ('Europe/Minsk','node22.23.3_intl_supported_values_v1'),
 ('Europe/Monaco','node22.23.3_intl_supported_values_v1'),
 ('Europe/Moscow','node22.23.3_intl_supported_values_v1'),
 ('Europe/Oslo','node22.23.3_intl_supported_values_v1'),
 ('Europe/Paris','node22.23.3_intl_supported_values_v1'),
 ('Europe/Podgorica','node22.23.3_intl_supported_values_v1'),
 ('Europe/Prague','node22.23.3_intl_supported_values_v1'),
 ('Europe/Riga','node22.23.3_intl_supported_values_v1'),
 ('Europe/Rome','node22.23.3_intl_supported_values_v1'),
 ('Europe/Samara','node22.23.3_intl_supported_values_v1'),
 ('Europe/San_Marino','node22.23.3_intl_supported_values_v1'),
 ('Europe/Sarajevo','node22.23.3_intl_supported_values_v1'),
 ('Europe/Saratov','node22.23.3_intl_supported_values_v1'),
 ('Europe/Simferopol','node22.23.3_intl_supported_values_v1'),
 ('Europe/Skopje','node22.23.3_intl_supported_values_v1'),
 ('Europe/Sofia','node22.23.3_intl_supported_values_v1'),
 ('Europe/Stockholm','node22.23.3_intl_supported_values_v1'),
 ('Europe/Tallinn','node22.23.3_intl_supported_values_v1'),
 ('Europe/Tirane','node22.23.3_intl_supported_values_v1'),
 ('Europe/Ulyanovsk','node22.23.3_intl_supported_values_v1'),
 ('Europe/Vaduz','node22.23.3_intl_supported_values_v1'),
 ('Europe/Vatican','node22.23.3_intl_supported_values_v1'),
 ('Europe/Vienna','node22.23.3_intl_supported_values_v1'),
 ('Europe/Vilnius','node22.23.3_intl_supported_values_v1'),
 ('Europe/Volgograd','node22.23.3_intl_supported_values_v1'),
 ('Europe/Warsaw','node22.23.3_intl_supported_values_v1'),
 ('Europe/Zagreb','node22.23.3_intl_supported_values_v1'),
 ('Europe/Zurich','node22.23.3_intl_supported_values_v1'),
 ('Indian/Antananarivo','node22.23.3_intl_supported_values_v1'),
 ('Indian/Chagos','node22.23.3_intl_supported_values_v1'),
 ('Indian/Christmas','node22.23.3_intl_supported_values_v1'),
 ('Indian/Cocos','node22.23.3_intl_supported_values_v1'),
 ('Indian/Comoro','node22.23.3_intl_supported_values_v1'),
 ('Indian/Kerguelen','node22.23.3_intl_supported_values_v1'),
 ('Indian/Mahe','node22.23.3_intl_supported_values_v1'),
 ('Indian/Maldives','node22.23.3_intl_supported_values_v1'),
 ('Indian/Mauritius','node22.23.3_intl_supported_values_v1'),
 ('Indian/Mayotte','node22.23.3_intl_supported_values_v1'),
 ('Indian/Reunion','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Apia','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Auckland','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Bougainville','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Chatham','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Easter','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Efate','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Enderbury','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Fakaofo','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Fiji','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Funafuti','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Galapagos','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Gambier','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Guadalcanal','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Guam','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Honolulu','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Kiritimati','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Kosrae','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Kwajalein','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Majuro','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Marquesas','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Midway','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Nauru','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Niue','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Norfolk','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Noumea','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Pago_Pago','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Palau','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Pitcairn','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Ponape','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Port_Moresby','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Rarotonga','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Saipan','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Tahiti','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Tarawa','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Tongatapu','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Truk','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Wake','node22.23.3_intl_supported_values_v1'),
 ('Pacific/Wallis','node22.23.3_intl_supported_values_v1'),
 ('UTC','node22.23.3_intl_supported_values_v1');

CREATE TRIGGER canonical_automation_canonical_time_zones_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_canonical_time_zones_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

CREATE TABLE public.canonical_automation_action_schedules_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 schedule_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 run_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 outbox_id UUID NOT NULL,
 unit_digest TEXT NOT NULL CHECK(unit_digest~'^sha256:[0-9a-f]{64}$'),
 policy_id UUID NOT NULL,
 policy_version BIGINT NOT NULL CHECK(policy_version BETWEEN 1 AND 9007199254740991),
 policy_digest TEXT NOT NULL CHECK(policy_digest~'^sha256:[0-9a-f]{64}$'),
 source_set_digest TEXT NOT NULL CHECK(source_set_digest~'^sha256:[0-9a-f]{64}$'),
 tenant_time_zone TEXT NOT NULL REFERENCES public.canonical_automation_canonical_time_zones_v1(tenant_time_zone)
  CHECK(octet_length(tenant_time_zone) BETWEEN 3 AND 64),
 local_date DATE NOT NULL,
 local_time TIME(0) NOT NULL,
 utc_instant TIMESTAMPTZ(6) NOT NULL,
 fold_resolution TEXT NOT NULL CHECK(fold_resolution IN('not_ambiguous','earlier','later')),
 calendar_id UUID NOT NULL,
 calendar_version BIGINT NOT NULL CHECK(calendar_version BETWEEN 1 AND 9007199254740991),
 calendar_digest TEXT NOT NULL CHECK(calendar_digest~'^sha256:[0-9a-f]{64}$'),
 schedule_binding_digest TEXT NOT NULL CHECK(schedule_binding_digest~'^sha256:[0-9a-f]{64}$'),
 expires_at TIMESTAMPTZ(6) NOT NULL,
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 state TEXT NOT NULL CHECK(state='scheduled_unpublished'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 65536),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,schedule_id),
 UNIQUE(organization_id,unit_id),
 UNIQUE(organization_id,outbox_id),
 UNIQUE(organization_id,request_digest),
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,outbox_id)
  REFERENCES public.canonical_automation_action_outbox_v1(organization_id,outbox_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,policy_id,policy_version)
  REFERENCES public.canonical_automation_policy_versions_v1(organization_id,policy_id,version) ON DELETE RESTRICT,
 CHECK(retention_class='decision_history'),
 CHECK(document->>'tenantId' IS NOT DISTINCT FROM organization_id::text),
 CHECK(document->>'scheduleId' IS NOT DISTINCT FROM schedule_id::text),
 CHECK(document->>'transactionId' IS NOT DISTINCT FROM transaction_id::text),
 CHECK(document->>'runId' IS NOT DISTINCT FROM run_id::text),
 CHECK(document#>>'{unitBinding,unitId}' IS NOT DISTINCT FROM unit_id::text),
 CHECK(document#>>'{unitBinding,outboxId}' IS NOT DISTINCT FROM outbox_id::text),
 CHECK(document#>>'{unitBinding,unitDigest}' IS NOT DISTINCT FROM unit_digest),
 CHECK(document#>>'{policyBinding,policyId}' IS NOT DISTINCT FROM policy_id::text),
 CHECK((document#>>'{policyBinding,policyVersion}')::bigint IS NOT DISTINCT FROM policy_version),
 CHECK(document#>>'{policyBinding,policyDigest}' IS NOT DISTINCT FROM policy_digest),
 CHECK(document#>>'{sourceBinding,sourceSetDigest}' IS NOT DISTINCT FROM source_set_digest),
 CHECK(document#>>'{localSchedule,tenantTimeZone}' IS NOT DISTINCT FROM tenant_time_zone),
 CHECK(document#>>'{localSchedule,localDate}' IS NOT DISTINCT FROM to_char(local_date,'YYYY-MM-DD')),
 CHECK(document#>>'{localSchedule,localTime}' IS NOT DISTINCT FROM to_char(local_time,'HH24:MI:SS')),
 CHECK(document#>>'{localSchedule,utcInstant}' IS NOT DISTINCT FROM public.canonical_automation_utc_v1(utc_instant)),
 CHECK(document#>>'{localSchedule,foldResolution}' IS NOT DISTINCT FROM fold_resolution),
 CHECK(document#>>'{calendarBinding,calendarId}' IS NOT DISTINCT FROM calendar_id::text),
 CHECK((document#>>'{calendarBinding,calendarVersion}')::bigint IS NOT DISTINCT FROM calendar_version),
 CHECK(document#>>'{calendarBinding,calendarDigest}' IS NOT DISTINCT FROM calendar_digest),
 CHECK(document#>>'{calendarBinding,calendarState}' IS NOT DISTINCT FROM 'exact_current'),
 CHECK(document#>>'{calendarBinding,tenantTimeZone}' IS NOT DISTINCT FROM tenant_time_zone),
 CHECK(document#>>'{expirationBinding,expiresAt}' IS NOT DISTINCT FROM public.canonical_automation_utc_v1(expires_at)),
 CHECK(document#>>'{trustedClockBinding,contract}' IS NOT DISTINCT FROM trusted_clock_contract),
 CHECK(document->>'scheduleBindingDigest' IS NOT DISTINCT FROM schedule_binding_digest),
 CHECK(document->>'requestDigest' IS NOT DISTINCT FROM request_digest)
);

CREATE INDEX canonical_automation_action_schedules_v1_due
 ON public.canonical_automation_action_schedules_v1(organization_id,utc_instant,schedule_id)
 WHERE state='scheduled_unpublished';
CREATE INDEX canonical_automation_action_schedules_v1_run
 ON public.canonical_automation_action_schedules_v1(organization_id,run_id,recorded_at,schedule_id);

CREATE TRIGGER canonical_automation_action_schedules_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_action_schedules_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_action_schedules_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_action_schedules_v1 FORCE ROW LEVEL SECURITY;
CREATE POLICY canonical_automation_action_schedules_v1_tenant_owner_only
 ON public.canonical_automation_action_schedules_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_action_schedules_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_action_schedules_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));

CREATE FUNCTION public.canonical_automation_store_action_schedule_v1(
 canonical_text_value TEXT, trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public SET TimeZone='UTC' AS $$
DECLARE
 doc JSONB; org UUID; schedule_value UUID; transaction_value UUID; run_value UUID; unit_value UUID; outbox_value UUID;
 policy_value UUID; policy_version_value BIGINT; calendar_value UUID; calendar_version_value BIGINT;
 request_digest_value TEXT; calendar_digest_value TEXT; schedule_digest_value TEXT; trusted_expected JSONB;
 local_date_value DATE; local_time_value TIME(0); local_timestamp_value TIMESTAMP(0);
 utc_value TIMESTAMPTZ(6); expires_value TIMESTAMPTZ(6); recorded_value TIMESTAMPTZ(6);
 zone_value TEXT; fold_value TEXT; match_count INTEGER; earlier_match TIMESTAMPTZ(6); later_match TIMESTAMPTZ(6);
 local_day INTEGER; local_minute INTEGER; window_item RECORD; holiday_item RECORD;
 previous_day INTEGER; previous_start INTEGER; previous_end INTEGER; item_day INTEGER; item_start INTEGER; item_end INTEGER;
 previous_holiday DATE; latest_policy_state TEXT; latest_snapshot_id UUID; snapshot_item RECORD;
 source_index INTEGER; snapshot_count INTEGER;
 stored public.canonical_automation_action_schedules_v1%ROWTYPE;
 transaction_row public.canonical_automation_action_transactions_v1%ROWTYPE;
 unit_row public.canonical_automation_action_units_v1%ROWTYPE;
 outbox_row public.canonical_automation_action_outbox_v1%ROWTYPE;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 65536 THEN
  RAISE EXCEPTION 'Mission 28 action schedule bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY['schemaVersion','tenantId','scheduleId','transactionId','runId',
  'unitBinding','policyBinding','sourceBinding','localSchedule','calendarBinding','expirationBinding','trustedClockBinding',
  'scheduleBindingDigest','requestDigest']) IS DISTINCT FROM TRUE OR
  doc->>'schemaVersion' IS DISTINCT FROM 'mission28.action-schedule.request.v1' OR
  COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(doc->>'scheduleId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(doc->>'transactionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(doc->>'runId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(doc->>'scheduleBindingDigest','')!~'^sha256:[0-9a-f]{64}$' OR
  COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Mission 28 action schedule shape invalid' USING ERRCODE='22023'; END IF;
 IF public.canonical_automation_part4b_keys_exact_v1(doc->'unitBinding',ARRAY['unitId','outboxId','unitDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'policyBinding',ARRAY['policyId','policyVersion','policyDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'sourceBinding',ARRAY['sourceSetDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'localSchedule',ARRAY['tenantTimeZone','localDate','localTime','utcInstant','foldResolution']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'calendarBinding',ARRAY['calendarId','calendarVersion','calendarDigest','calendarState','tenantTimeZone','allowedWeeklyWindows','quietWeeklyWindows','holidayDates']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'expirationBinding',ARRAY['expiresAt']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'trustedClockBinding',ARRAY['contract']) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 action schedule binding shape invalid' USING ERRCODE='22023'; END IF;
 IF COALESCE(doc#>>'{unitBinding,unitId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{unitBinding,outboxId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{unitBinding,unitDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{policyBinding,policyId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    jsonb_typeof(doc#>'{policyBinding,policyVersion}') IS DISTINCT FROM 'number' OR
    COALESCE(doc#>>'{policyBinding,policyVersion}','')!~'^[1-9][0-9]*$' OR
    COALESCE(doc#>>'{policyBinding,policyDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{sourceBinding,sourceSetDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{calendarBinding,calendarId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    jsonb_typeof(doc#>'{calendarBinding,calendarVersion}') IS DISTINCT FROM 'number' OR
    COALESCE(doc#>>'{calendarBinding,calendarVersion}','')!~'^[1-9][0-9]*$' OR
    COALESCE(doc#>>'{calendarBinding,calendarDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    doc#>>'{calendarBinding,calendarState}' IS DISTINCT FROM 'exact_current' OR
    jsonb_typeof(doc#>'{calendarBinding,allowedWeeklyWindows}') IS DISTINCT FROM 'array' OR
    jsonb_typeof(doc#>'{calendarBinding,quietWeeklyWindows}') IS DISTINCT FROM 'array' OR
    jsonb_typeof(doc#>'{calendarBinding,holidayDates}') IS DISTINCT FROM 'array' OR
    doc#>>'{trustedClockBinding,contract}' IS DISTINCT FROM 'postgresql_statement_timestamp_v1' THEN
  RAISE EXCEPTION 'Mission 28 schedule identity or calendar invalid' USING ERRCODE='22023'; END IF;
 IF COALESCE(doc#>>'{localSchedule,tenantTimeZone}','')!~'^(UTC|[A-Za-z]+(?:[_-][A-Za-z]+)*(?:/[A-Za-z]+(?:[_-][A-Za-z]+)*)+)$' OR
    octet_length(doc#>>'{localSchedule,tenantTimeZone}') NOT BETWEEN 3 AND 64 OR
    doc#>>'{calendarBinding,tenantTimeZone}' IS DISTINCT FROM doc#>>'{localSchedule,tenantTimeZone}' OR
    COALESCE(doc#>>'{localSchedule,localDate}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR
    COALESCE(doc#>>'{localSchedule,localTime}','')!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$' OR
    COALESCE(doc#>>'{localSchedule,utcInstant}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR
    COALESCE(doc#>>'{expirationBinding,expiresAt}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR
    COALESCE(doc#>>'{localSchedule,foldResolution}','') NOT IN('not_ambiguous','earlier','later') THEN
  RAISE EXCEPTION 'Mission 28 schedule time material invalid' USING ERRCODE='22023'; END IF;

 org:=(doc->>'tenantId')::uuid; schedule_value:=(doc->>'scheduleId')::uuid;
 transaction_value:=(doc->>'transactionId')::uuid; run_value:=(doc->>'runId')::uuid;
 unit_value:=(doc#>>'{unitBinding,unitId}')::uuid; outbox_value:=(doc#>>'{unitBinding,outboxId}')::uuid;
 policy_value:=(doc#>>'{policyBinding,policyId}')::uuid; policy_version_value:=(doc#>>'{policyBinding,policyVersion}')::bigint;
 calendar_value:=(doc#>>'{calendarBinding,calendarId}')::uuid; calendar_version_value:=(doc#>>'{calendarBinding,calendarVersion}')::bigint;
 calendar_digest_value:=public.canonical_automation_digest_v1('mission28.business-calendar.v1'||chr(10),jsonb_build_object(
  'tenantId',doc->>'tenantId','calendarId',doc#>>'{calendarBinding,calendarId}',
  'calendarVersion',doc#>'{calendarBinding,calendarVersion}','calendarState',doc#>>'{calendarBinding,calendarState}',
  'tenantTimeZone',doc#>>'{calendarBinding,tenantTimeZone}','allowedWeeklyWindows',doc#>'{calendarBinding,allowedWeeklyWindows}',
  'quietWeeklyWindows',doc#>'{calendarBinding,quietWeeklyWindows}','holidayDates',doc#>'{calendarBinding,holidayDates}'));
 IF calendar_digest_value IS DISTINCT FROM doc#>>'{calendarBinding,calendarDigest}' THEN
  RAISE EXCEPTION 'Mission 28 business calendar digest invalid' USING ERRCODE='22023'; END IF;
 schedule_digest_value:=public.canonical_automation_digest_v1('mission28.action-schedule-binding.v1'||chr(10),jsonb_build_object(
  'tenantId',doc->>'tenantId','transactionId',doc->>'transactionId','runId',doc->>'runId',
  'unitBinding',doc->'unitBinding','policyBinding',doc->'policyBinding','sourceBinding',doc->'sourceBinding',
  'localSchedule',doc->'localSchedule','calendarBinding',doc->'calendarBinding',
  'expirationBinding',doc->'expirationBinding','trustedClockBinding',doc->'trustedClockBinding'));
 IF schedule_digest_value IS DISTINCT FROM doc->>'scheduleBindingDigest' THEN
  RAISE EXCEPTION 'Mission 28 schedule binding digest invalid' USING ERRCODE='22023'; END IF;
 request_digest_value:=public.canonical_automation_digest_v1('mission28.action-schedule.request.v1'||chr(10),doc-'requestDigest');
 IF request_digest_value IS DISTINCT FROM doc->>'requestDigest' THEN
  RAISE EXCEPTION 'Mission 28 schedule request digest invalid' USING ERRCODE='22023'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-action-schedule:'||schedule_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 SELECT * INTO stored FROM public.canonical_automation_action_schedules_v1
  WHERE organization_id=org AND schedule_id=schedule_value;
 IF stored.schedule_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN
   RAISE EXCEPTION 'Mission 28 conflicting action schedule identity' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('state','scheduled_unpublished','replayed',TRUE,'scheduleId',schedule_value,
   'unitId',stored.unit_id,'utcInstant',public.canonical_automation_utc_v1(stored.utc_instant),
   'requestDigest',stored.request_digest,'recordedAt',public.canonical_automation_utc_v1(stored.recorded_at));
 END IF;

 trusted_expected:=jsonb_build_object('tenantId',doc->>'tenantId','transactionId',doc->>'transactionId','runId',doc->>'runId',
  'unitBinding',doc->'unitBinding','policyBinding',doc->'policyBinding','sourceBinding',doc->'sourceBinding',
  'localSchedule',doc->'localSchedule','calendarBinding',doc->'calendarBinding','expirationBinding',doc->'expirationBinding',
  'trustedClockBinding',doc->'trustedClockBinding','scheduleBindingDigest',doc->>'scheduleBindingDigest');
 IF public.canonical_automation_part4b_keys_exact_v1(trusted_resolution,ARRAY['tenantId','transactionId','runId','unitBinding',
   'policyBinding','sourceBinding','localSchedule','calendarBinding','expirationBinding','trustedClockBinding','scheduleBindingDigest']) IS DISTINCT FROM TRUE OR
    trusted_resolution IS DISTINCT FROM trusted_expected THEN
  RAISE EXCEPTION 'Mission 28 separately trusted schedule resolution mismatch' USING ERRCODE='42501'; END IF;

 zone_value:=doc#>>'{localSchedule,tenantTimeZone}'; fold_value:=doc#>>'{localSchedule,foldResolution}';
 IF NOT EXISTS(SELECT 1 FROM public.canonical_automation_canonical_time_zones_v1
      WHERE tenant_time_zone=zone_value) OR
    NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=zone_value) THEN
  RAISE EXCEPTION 'Mission 28 exact canonical tenant time zone unavailable' USING ERRCODE='42501'; END IF;
 BEGIN
  local_date_value:=(doc#>>'{localSchedule,localDate}')::date;
  local_time_value:=(doc#>>'{localSchedule,localTime}')::time(0);
  utc_value:=(doc#>>'{localSchedule,utcInstant}')::timestamptz(6);
  expires_value:=(doc#>>'{expirationBinding,expiresAt}')::timestamptz(6);
 EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Mission 28 schedule timestamp invalid' USING ERRCODE='22023';
 END;
 IF to_char(local_date_value,'YYYY-MM-DD') IS DISTINCT FROM doc#>>'{localSchedule,localDate}' OR
    to_char(local_time_value,'HH24:MI:SS') IS DISTINCT FROM doc#>>'{localSchedule,localTime}' OR
    public.canonical_automation_utc_v1(utc_value) IS DISTINCT FROM doc#>>'{localSchedule,utcInstant}' OR
    public.canonical_automation_utc_v1(expires_value) IS DISTINCT FROM doc#>>'{expirationBinding,expiresAt}' THEN
  RAISE EXCEPTION 'Mission 28 schedule timestamp canonicalization invalid' USING ERRCODE='22023'; END IF;
 local_timestamp_value:=local_date_value+local_time_value;
 SELECT count(*)::integer,min(candidate),max(candidate) INTO match_count,earlier_match,later_match
 FROM generate_series(utc_value-INTERVAL '24 hours',utc_value+INTERVAL '24 hours',INTERVAL '1 minute') candidate
 WHERE candidate AT TIME ZONE zone_value=local_timestamp_value;
 IF match_count=0 OR match_count>2 OR
    (match_count=1 AND (fold_value IS DISTINCT FROM 'not_ambiguous' OR utc_value IS DISTINCT FROM earlier_match)) OR
    (match_count=2 AND ((fold_value='earlier' AND utc_value IS DISTINCT FROM earlier_match) OR
      (fold_value='later' AND utc_value IS DISTINCT FROM later_match) OR fold_value='not_ambiguous')) THEN
  RAISE EXCEPTION 'Mission 28 daylight-saving schedule resolution invalid' USING ERRCODE='22023'; END IF;

 IF jsonb_array_length(doc#>'{calendarBinding,allowedWeeklyWindows}') NOT BETWEEN 1 AND 32 OR
    jsonb_array_length(doc#>'{calendarBinding,quietWeeklyWindows}') NOT BETWEEN 0 AND 32 OR
    jsonb_array_length(doc#>'{calendarBinding,holidayDates}') NOT BETWEEN 0 AND 64 THEN
  RAISE EXCEPTION 'Mission 28 business calendar bounds invalid' USING ERRCODE='22023'; END IF;
 previous_day:=NULL; previous_start:=NULL; previous_end:=NULL;
 FOR window_item IN SELECT value,ordinality FROM jsonb_array_elements(doc#>'{calendarBinding,allowedWeeklyWindows}') WITH ORDINALITY LOOP
  IF public.canonical_automation_part4b_keys_exact_v1(window_item.value,ARRAY['dayId','startMinuteInclusive','endMinuteExclusive']) IS DISTINCT FROM TRUE OR
     jsonb_typeof(window_item.value->'dayId') IS DISTINCT FROM 'number' OR
     jsonb_typeof(window_item.value->'startMinuteInclusive') IS DISTINCT FROM 'number' OR
     jsonb_typeof(window_item.value->'endMinuteExclusive') IS DISTINCT FROM 'number' OR
     COALESCE(window_item.value->>'dayId','')!~'^[1-7]$' OR
     COALESCE(window_item.value->>'startMinuteInclusive','')!~'^(0|[1-9][0-9]{0,3})$' OR
     COALESCE(window_item.value->>'endMinuteExclusive','')!~'^[1-9][0-9]{0,3}$' THEN
   RAISE EXCEPTION 'Mission 28 allowed business window shape invalid' USING ERRCODE='22023'; END IF;
  item_day:=(window_item.value->>'dayId')::integer; item_start:=(window_item.value->>'startMinuteInclusive')::integer;
  item_end:=(window_item.value->>'endMinuteExclusive')::integer;
  IF item_start>=item_end OR item_end>1440 OR
     (previous_day IS NOT NULL AND (item_day<previous_day OR (item_day=previous_day AND item_start<previous_end))) THEN
   RAISE EXCEPTION 'Mission 28 allowed business window order invalid' USING ERRCODE='22023'; END IF;
  previous_day:=item_day; previous_start:=item_start; previous_end:=item_end;
 END LOOP;
 previous_day:=NULL; previous_start:=NULL; previous_end:=NULL;
 FOR window_item IN SELECT value,ordinality FROM jsonb_array_elements(doc#>'{calendarBinding,quietWeeklyWindows}') WITH ORDINALITY LOOP
  IF public.canonical_automation_part4b_keys_exact_v1(window_item.value,ARRAY['dayId','startMinuteInclusive','endMinuteExclusive']) IS DISTINCT FROM TRUE OR
     jsonb_typeof(window_item.value->'dayId') IS DISTINCT FROM 'number' OR
     jsonb_typeof(window_item.value->'startMinuteInclusive') IS DISTINCT FROM 'number' OR
     jsonb_typeof(window_item.value->'endMinuteExclusive') IS DISTINCT FROM 'number' OR
     COALESCE(window_item.value->>'dayId','')!~'^[1-7]$' OR
     COALESCE(window_item.value->>'startMinuteInclusive','')!~'^(0|[1-9][0-9]{0,3})$' OR
     COALESCE(window_item.value->>'endMinuteExclusive','')!~'^[1-9][0-9]{0,3}$' THEN
   RAISE EXCEPTION 'Mission 28 quiet window shape invalid' USING ERRCODE='22023'; END IF;
  item_day:=(window_item.value->>'dayId')::integer; item_start:=(window_item.value->>'startMinuteInclusive')::integer;
  item_end:=(window_item.value->>'endMinuteExclusive')::integer;
  IF item_start>=item_end OR item_end>1440 OR
     (previous_day IS NOT NULL AND (item_day<previous_day OR (item_day=previous_day AND item_start<previous_end))) THEN
   RAISE EXCEPTION 'Mission 28 quiet window order invalid' USING ERRCODE='22023'; END IF;
  previous_day:=item_day; previous_start:=item_start; previous_end:=item_end;
 END LOOP;
 previous_holiday:=NULL;
 FOR holiday_item IN SELECT value,ordinality FROM jsonb_array_elements(doc#>'{calendarBinding,holidayDates}') WITH ORDINALITY LOOP
  IF jsonb_typeof(holiday_item.value) IS DISTINCT FROM 'string' OR
     COALESCE(holiday_item.value#>>'{}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION 'Mission 28 holiday date shape invalid' USING ERRCODE='22023'; END IF;
  BEGIN local_date_value:=(holiday_item.value#>>'{}')::date;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Mission 28 holiday date invalid' USING ERRCODE='22023'; END;
  IF to_char(local_date_value,'YYYY-MM-DD') IS DISTINCT FROM holiday_item.value#>>'{}' OR
     (previous_holiday IS NOT NULL AND local_date_value<=previous_holiday) THEN
   RAISE EXCEPTION 'Mission 28 holiday date order invalid' USING ERRCODE='22023'; END IF;
  previous_holiday:=local_date_value;
 END LOOP;
 local_date_value:=(doc#>>'{localSchedule,localDate}')::date;
 local_day:=extract(isodow FROM local_date_value)::integer;
 local_minute:=extract(hour FROM local_time_value)::integer*60+extract(minute FROM local_time_value)::integer;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(doc#>'{calendarBinding,allowedWeeklyWindows}') value
    WHERE (value->>'dayId')::integer=local_day AND local_minute>=(value->>'startMinuteInclusive')::integer
      AND local_minute<(value->>'endMinuteExclusive')::integer) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(doc#>'{calendarBinding,quietWeeklyWindows}') value
    WHERE (value->>'dayId')::integer=local_day AND local_minute>=(value->>'startMinuteInclusive')::integer
      AND local_minute<(value->>'endMinuteExclusive')::integer) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements_text(doc#>'{calendarBinding,holidayDates}') value
      WHERE value=to_char(local_date_value,'YYYY-MM-DD')) THEN
  RAISE EXCEPTION 'Mission 28 schedule blocked by business calendar' USING ERRCODE='42501'; END IF;

 recorded_value:=public.canonical_automation_clock_v1();
 IF utc_value<=recorded_value OR utc_value>recorded_value+INTERVAL '366 days' OR
    expires_value<=utc_value OR expires_value>recorded_value+INTERVAL '367 days' THEN
  RAISE EXCEPTION 'Mission 28 schedule expiration or trusted-clock bound invalid' USING ERRCODE='42501'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-action-unit-schedule:'||unit_value::text,0));
 SELECT * INTO transaction_row FROM public.canonical_automation_action_transactions_v1
  WHERE organization_id=org AND transaction_id=transaction_value AND run_id=run_value
   AND policy_id=policy_value AND policy_version=policy_version_value
   AND policy_digest=doc#>>'{policyBinding,policyDigest}' AND source_set_digest=doc#>>'{sourceBinding,sourceSetDigest}';
 SELECT * INTO unit_row FROM public.canonical_automation_action_units_v1
  WHERE organization_id=org AND unit_id=unit_value AND transaction_id=transaction_value AND run_id=run_value
   AND unit_digest=doc#>>'{unitBinding,unitDigest}' AND state='committed_unpublished';
 SELECT * INTO outbox_row FROM public.canonical_automation_action_outbox_v1
  WHERE organization_id=org AND outbox_id=outbox_value AND transaction_id=transaction_value AND unit_id=unit_value
   AND unit_digest=doc#>>'{unitBinding,unitDigest}' AND state='committed_unpublished'
   AND queue_publication_id IS NULL AND queue_published_at IS NULL AND claim_id IS NULL AND lease_expires_at IS NULL;
 IF transaction_row.transaction_id IS NULL OR unit_row.unit_id IS NULL OR outbox_row.outbox_id IS NULL THEN
  RAISE EXCEPTION 'Mission 28 exact Part 6A action authority unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_automation_action_schedules_v1
   WHERE organization_id=org AND (unit_id=unit_value OR outbox_id=outbox_value)) THEN
  RAISE EXCEPTION 'Mission 28 action unit already scheduled' USING ERRCODE='23505'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-lifecycle-policy:'||policy_value::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.canonical_automation_policy_versions_v1
   WHERE organization_id=org AND policy_id=policy_value AND version=policy_version_value
    AND canonical_digest=doc#>>'{policyBinding,policyDigest}' AND expires_at>recorded_value) THEN
  RAISE EXCEPTION 'Mission 28 exact current policy unavailable for scheduling' USING ERRCODE='42501'; END IF;
 SELECT to_state INTO latest_policy_state FROM public.canonical_automation_lifecycle_events_v1
  WHERE organization_id=org AND policy_id=policy_value AND policy_version=policy_version_value
  ORDER BY lifecycle_sequence DESC LIMIT 1;
 IF latest_policy_state IS DISTINCT FROM 'active' THEN
  RAISE EXCEPTION 'Mission 28 active policy unavailable for scheduling' USING ERRCODE='42501'; END IF;
 snapshot_count:=jsonb_array_length(transaction_row.document#>'{sourceBinding,snapshotIds}');
 FOR source_index IN 0..snapshot_count-1 LOOP
  SELECT * INTO snapshot_item FROM public.canonical_automation_trigger_snapshots_v1
   WHERE organization_id=org
    AND snapshot_id=(transaction_row.document#>>ARRAY['sourceBinding','snapshotIds',source_index::text])::uuid
    AND snapshot_digest=transaction_row.document#>>ARRAY['sourceBinding','snapshotDigests',source_index::text];
  IF snapshot_item.snapshot_id IS NULL OR snapshot_item.document#>>'{currentness,availability}' IS DISTINCT FROM 'available_exact_current' THEN
   RAISE EXCEPTION 'Mission 28 exact current source unavailable for scheduling' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-source-lineage:'||snapshot_item.trigger_id||':'||
   snapshot_item.record_identity_digest||':'||snapshot_item.event_kind,0));
  SELECT snapshot_id INTO latest_snapshot_id FROM public.canonical_automation_trigger_snapshots_v1
   WHERE organization_id=org AND trigger_id=snapshot_item.trigger_id
    AND record_identity_digest=snapshot_item.record_identity_digest AND event_kind=snapshot_item.event_kind
   ORDER BY lineage_sequence DESC LIMIT 1;
  IF latest_snapshot_id IS DISTINCT FROM snapshot_item.snapshot_id THEN
   RAISE EXCEPTION 'Mission 28 source snapshot is not latest scheduling head' USING ERRCODE='42501'; END IF;
 END LOOP;

 INSERT INTO public.canonical_automation_action_schedules_v1 VALUES(
  org,schedule_value,transaction_value,run_value,unit_value,outbox_value,doc#>>'{unitBinding,unitDigest}',
  policy_value,policy_version_value,doc#>>'{policyBinding,policyDigest}',doc#>>'{sourceBinding,sourceSetDigest}',
  zone_value,(doc#>>'{localSchedule,localDate}')::date,(doc#>>'{localSchedule,localTime}')::time(0),utc_value,fold_value,
  calendar_value,calendar_version_value,calendar_digest_value,schedule_digest_value,expires_value,request_digest_value,
  'scheduled_unpublished',canonical_text_value,doc,'decision_history','postgresql_statement_timestamp_v1','UTC',recorded_value);
 RETURN jsonb_build_object('state','scheduled_unpublished','replayed',FALSE,'scheduleId',schedule_value,'unitId',unit_value,
  'utcInstant',public.canonical_automation_utc_v1(utc_value),'requestDigest',request_digest_value,
  'recordedAt',public.canonical_automation_utc_v1(recorded_value));
END $$;

REVOKE ALL ON TABLE public.canonical_automation_canonical_time_zones_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_automation_action_schedules_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_store_action_schedule_v1(TEXT,JSONB) FROM PUBLIC;
