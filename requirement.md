Jobs finder

Problem scenarios:
    Noramlly what people do is, lets say someone is searching for a job with their role, matching their profile, matching job description, by crawling through different job portals like linkedin, indeed, many others. so first they visi the job portal site, scrolling all the feeds one by one, search for such post which match their profile, and click on that
    post, apply by filling up form through various way, some post might have apply button, so user click apply button, fillup the form, upload resume (if given form field) adn submit, what if there is 100 of post, filtering out manuall is really frustrating and even reading long paragraphs of JD really time consuming. 


Objectives:
    So our objectives of this application will be full agentic based automation, no need to scroll and read all the job posts, no need to read each post job description, compairing with our profile, instead, our agent will do all this jobs and actions. All we have to do is provide agent our resume, select job portal like linkedin, indeed, ... (can be multi select portal or all) and agent will read all ours resume details, and do jobs search, and apply to all which matches to our profile. 


Feature requirements:
    1. Left sidebar (Collapsible) wih nav items -> Dashboard, My Detials, History, AI Resume Enahncer
    2. Dashboard with analytics + Date wise filter (TODAY/YESTERDAY/WEEK/MONTH/Customer date picker)
        - Total number of jobs applied 
        - Total number of maching profiles
        - Probability of getting shortlisted
            - based on number of user applied for that posts
            - Percentage/Rating of mathcing our profile to the JD
            - other userfull important parameters which will add more authentic and real analytics (lets disccuss)
    2. My Details
        - Resume upload section (Draggabble zone + Upload button + Pdf supported only + Multi select and upload files)
        - After upload, render the upload pdf files with preview icon on the top right where on user click will open modal rendering enitre pdf content
        - Form box with additive buttons for portal where on box card has one field portal url like linkedin, indeed, ... (set this to portal link by default)

    3. History
        - it contains all the list of applied jobs, Search jobs based on our profile and roles.
        - Lets and chip filter based on 'Applied', 'Profile Matching',...what else we need or its enough for now ?
        - Render in card form where card containers which must contains
            - Company name
            - Position
            - Profile mathcing percentage
                - List out the matching terms
            - Probability of getting shortlised (percentage)
            - Improvement suggestions like whats needs to be add to our profile to get 100% matching like technology, skills, .....
    4. AI Resume Enahncer
        - On the tops, there will be list of card with percentage, where each card has achieved percentage/total percentages, lets think of this card like what should be there for this context, which measure and track our  resume strong level.
        - this is the section here AI do magic in enhancing your resume to strong, selective resume not in context of UI, but in context of strong skills suggestion, market trend, market demand, and turn your leaerning into mileston based on your profile, experience, skills, tools and technology
        - Agent learns the context from Applied history details, like improvemnt suggestions, filter our frequently mentioned keys and after analyzing all, turn it into milestone for users, based on priority 
        - Mileston must be checkable or uncheckable, after user check means user completed each milestone, agnet will analyze and add the skills to the resume intelligently



Lets plan and design the system, first clariying the requirements, tell me what are the requirement parameters to make agent 100% accurate wihtout hallicunaing, then after discuss and plan, do clean changes with moduler, re-usable components, dynamic and beutiful code architecture.