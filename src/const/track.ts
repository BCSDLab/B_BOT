export const TRACKS_LOWERCASE = ["frontend", "backend", "android", "uiux", "ios", "game"] as const;

export const TRACKS_KOREAN = ["프론트엔드", "벡엔드", "안드로이드", "유아이유엑스", "아이오세스", "게임", "프엔", "벡엔", "안드"] as const;

export const TRACK_NAME_MAPPER = {
  "frontend": "FrontEnd",
  "backend": "BackEnd",
  "android": "Android",
  "uiux": "UI/UX",
  "ios": "iOS",
  "game": "Game",
  "pm": "Product Manager",
  "da": "Data Analyst",
} as const;

export const TRACK_NAME_KOREAN_MAPPER = {
  "프론트엔드": "frontend",
  "벡엔드": "backend",
  "안드로이드": "android",
  "유아이유엑스": "uiux",
  "아이오에스": "ios",
  "게임": "game",
  "프엔": "frontend",
  "벡엔": "backend",
  "안드": "android",
} as const;

export const MEMBER_TYPES_KOREAN_MAPPER = {
  "비기너": "beginner",
  "레귤러": "regular",
  "멘토": "mentor" 
}
export const MEMBER_TYPES_LOWERCASE = ["beginner", "regular", "mentor"] as const;

export const MEMBER_TYPES_KOREAN = ["비기너", "레귤러", "멘토"] as const;

export const BCSD_ACTIVE_MEMBER_LIST = {
  "business": {
    "frontend": ["채승윤", "최정훈", "김대관", "김대의"],
    "backend" : ["이현수", "최준호","장준영"],
    "uiux" : ["장민지"],
    "android" : ["고효석", "장나영"],
    "ios" : [],
    "pm" : [],
    "da" : [],
    "game" : [],
  },
  "campus": {
    "frontend" : ["정민구", "정해성", "김경윤"],
    "backend" : ["황현식", "송선권", "박성빈", "허준기"],
    "uiux" : ["김채은"],
    "android" : ["배수민", "이상일"],
    "ios" : ["김나훈","정영준"],
    "pm" : [],
    "da" : [],
    "game" : [],
  },
  "user" : {
    "frontend" : ["김도훈", "곽승주", "김하나"],
    "backend" : ["서정빈", "김성재", "박다희", "김원경"],
    "uiux" : ["최민경"],
    "android" : ["조관희", "김도혁"],
    "ios" : [],
    "pm" : [],
    "da" : [],
    "game" : [],
  }
}
