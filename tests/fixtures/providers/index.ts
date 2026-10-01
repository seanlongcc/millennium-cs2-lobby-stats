export const envelope=(data:unknown,status='ok')=>JSON.stringify({status,data,fetched_at:1700000000});
export const faceitFixture=(stats:unknown)=>envelope({nickname:'Synthetic',level:8,elo:1800,stats});
export const leetifyFixture=()=>envelope({name:'<img src=x onerror=alert(1)>',privacy_mode:'public',total_matches:500,ranks:{leetify:-1.2,premier:12000},rating:{aim:95,utility:62,positioning:71},stats:{kd:2,kd_matches:20,reaction_time_ms:400,preaim:8,accuracy_enemy_spotted:34.4,counter_strafing:80.7}});
export const steamProfile='<profile><steamID64>76561197960265729</steamID64><steamID><![CDATA[Synthetic <player>]]></steamID><privacyState>public</privacyState><memberSince>January 1, 2020</memberSince></profile>';
export const steamFixture=(games:string)=>envelope({profile_xml:steamProfile,games_xml:games});
