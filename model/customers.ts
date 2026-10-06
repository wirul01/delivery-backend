

export interface buyer {
    buyer_id: number;
    fname: string;
    lname: string;
    contact_no: string;
    lat_val: string;
    lng_val: string;
}

export interface buyerPostRequest {
    fname: string;
    lname: string;
    contact_no: string;
    lat_val: string;
    lng_val: string;
}